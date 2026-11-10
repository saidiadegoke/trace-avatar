/**
 * trace-avatar/fix: "Fix this step" for an author, where a guide stalls in the app. Loaded only when an author
 * (record.allowed()) meets a step that can't find its element, or a wait whose text never showed (E8).
 *
 * Offer → a guess ("Is it this?") or pointing at the element → the element re-recorded (buildTarget) and checked
 * with the player's own resolver → the guide carries on from that step → save the fixed guide, or keep it for
 * this session only.
 */

import type { Guide } from '../core/manifest';
import type { Trace } from '../core/format';
import type { Ai } from '../core/assist';
import { GUESS_MIN, chooseRepair, chooseWait, guessWait, removeStep, targetLabel, typedOf } from '../core/repair';
import { candidatesOf, elementOf, resolvesTo, scopeFor, textsOf, untilHolds } from '../repair/index';
import type { SeenText } from '../shell/ports';
import { buildTarget, meaningful } from '../shell/selector.dom';

export interface FixOptions {
  doc?: Document;
  /** The guide as authored (not normalised): fixed and saved as it is. */
  trace: Trace;
  /** The stalled step (from 0). */
  index: number;
  /** Why it stalled: its element can't be found (default), or a wait's text never showed. */
  reason?: 'not-found' | 'until-timeout';
  /** until-timeout: the texts that showed while it waited (the stalled event's `seen`). */
  seen?: ReadonlyArray<string | SeenText>;
  /** The guide's manifest entry, passed to save. */
  entry: Guide;
  /** Asked only when no candidate is a clear winner. */
  ai?: Ai;
  /** Where a fixed guide goes. Without it, the fixed trace is downloaded. */
  /** Where the fixed guide goes; `info.from` is the guide's own id (it replaces a saved guide). */
  save?: (trace: Trace, entry: Guide, info: { from?: string }) => void | Promise<void>;
  /** The step is fixed: carry on from `index` with this trace (past the end: the guide is done). */
  onFixed(trace: Trace, index: number): void;
  /** The author chose Stop. */
  onStop(): void;
}

export interface Fix {
  readonly state: 'offer' | 'looking' | 'guess' | 'point' | 'fixed' | 'closed';
  close(): void;
}

/** A guess this good is shown ("Is it this?"); a person confirms it, so it needn't be a clear winner. */
export { GUESS_MIN };

const CSS = `
:host { all: initial; }
.card { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647; max-width: min(520px, calc(100vw - 32px));
  box-sizing: border-box; padding: 12px 14px; border-radius: 12px; background: #111827; color: #f9fafb; font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 10px 30px rgb(0 0 0 / .3); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.msg { flex: 1 1 220px; }
button { font: inherit; border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; background: #374151; color: #f9fafb; }
button.main { background: #2563eb; }
button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.ring { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid #2563eb; border-radius: 6px; box-shadow: 0 0 0 4px rgb(37 99 235 / .25); display: none; }
`;

export function offerFix(o: FixOptions): Fix {
  const doc = o.doc ?? document;
  const win = doc.defaultView!;
  let state: Fix['state'] = 'offer';
  let trace = o.trace;
  const step = trace.steps[o.index];
  const n = o.index + 1;

  const host = doc.createElement('div');
  host.setAttribute('data-trace-avatar', 'fix');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const card = doc.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Fix this step');
  const ring = doc.createElement('div');
  ring.className = 'ring';
  root.append(style, ring, card);
  (doc.body ?? doc.documentElement).append(host);

  let ringEl: Element | null = null;
  let raf = 0;
  const place = () => {
    raf = 0;
    if (!ringEl || !ringEl.isConnected) { ring.style.display = 'none'; return; }
    const r = ringEl.getBoundingClientRect();
    Object.assign(ring.style, { display: 'block', left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 2}px`, height: `${r.height + 2}px` });
    raf = win.requestAnimationFrame(place);
  };
  const outline = (el: Element | null) => {
    ringEl = el;
    if (el && !raf) raf = win.requestAnimationFrame(place);
    if (!el) ring.style.display = 'none';
    if (el) place();
  };

  const show = (msg: string, buttons: Array<[string, () => void, boolean?]>) => {
    card.replaceChildren();
    const m = doc.createElement('div');
    m.className = 'msg';
    m.setAttribute('role', 'status');
    m.textContent = msg;
    card.append(m);
    for (const [label, fn, main] of buttons) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (main) b.className = 'main';
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      card.append(b);
    }
    (card.querySelector('button.main') as HTMLButtonElement | null)?.focus();
  };

  // A wait whose text never showed (E8): fix the text it waits for, or remove the wait.
  const wait = o.reason === 'until-timeout';
  const gone = !!step?.until?.gone;
  const quote = (t: string) => `“${t}”`;
  const remove: [string, () => void] | null = wait && trace.steps.length > 1 ? ['Remove this wait', () => removeWait()] : null;

  const offer = () => {
    state = 'offer';
    stopPointing();
    outline(null);
    const stop: [string, () => void] = ['Stop', () => { close(); o.onStop(); }];
    if (!wait) show(`Step ${n} can’t find ${targetLabel(step?.target)}.`, [['Fix this step', () => void look(), true], stop]);
    else if (gone) show(`Step ${n} waited for ${targetLabel(step?.target)} to go, and it never did.`, [...(remove ? [remove] : []), stop]);
    else show(`Step ${n} waited for ${quote(step?.until?.text ?? '')}, which never showed.`, [['Fix this step', () => void lookText(), true], ...(remove ? [remove] : []), stop]);
  };

  /** The element a wait looks in: its target, or the page. */
  const scopeOf = (): ParentNode => scopeFor(step?.target, doc);

  async function lookText() {
    state = 'looking';
    show('Looking at the page…', []);
    const list = textsOf(scopeOf(), { seen: o.seen ?? [], typed: typedOf(trace) });
    let best: { id: number; text: string } | null = null;
    try {
      best = guessWait(await chooseWait(trace, o.index, list, o.ai ? { ai: o.ai } : {}), list);
    } catch { /* the AI failed: point instead */ }
    if (state !== 'looking') return;
    if (!best) { point(); return; }
    const el = elementOf(best.id);
    const text = best.text;
    state = 'guess';
    outline(el);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    show(`Is it ${quote(text)}?${el ? '' : ' (seen while waiting)'}`, [['Yes', () => setText(text), true], ['No, I’ll point at it', () => point()], ['Cancel', () => offer()]]);
  }

  /** Wait for `text` from now on: it must be on the page now (where the wait looks) or have shown while it waited. */
  function setText(text: string) {
    const typed = typedOf(trace);
    const ok = text.length >= 2 && text.length <= 60 && !typed.some((v) => text.toLowerCase().includes(v))
      && (untilHolds(text, step?.target, doc) || (o.seen ?? []).some((s) => (typeof s === 'string' ? s : s.text).toLowerCase().includes(text.toLowerCase())));
    if (!ok) {
      if (state !== 'point') point();
      show('This step can’t wait for that. Point at a short text where the step waits. Esc to cancel.', [['Cancel', () => offer()]]);
      return;
    }
    stopPointing();
    outline(null);
    const next: Trace = JSON.parse(JSON.stringify(trace));
    next.steps[o.index] = { ...next.steps[o.index], until: { text } };
    done(next, o.index + 1, `Fixed step ${n}: it waits for ${quote(text)}.`);
  }

  function removeWait() {
    done(removeStep(trace, o.index), o.index, `Removed step ${n} (the wait).`);
  }

  /** The guide is fixed: carry on from `from`, and offer to save. */
  function done(next: Trace, from: number, msg: string) {
    stopPointing();
    outline(null);
    trace = next;
    state = 'fixed';
    o.onFixed(next, from);
    show(msg, [['Save the guide', () => void save(), true], ['Just this time', () => close()]]);
  }

  async function look() {
    state = 'looking';
    show('Looking at the page…', []);
    const list = candidatesOf(doc);
    let best: number | null = null;
    try {
      const c = await chooseRepair(trace, o.index, list, o.ai ? { ai: o.ai } : {});
      if (c.id !== null) best = c.id;
      else if (c.top[0] && c.top[0].score >= GUESS_MIN) best = c.top[0].id;
    } catch { /* the AI failed: point instead */ }
    if (state !== 'looking') return;
    const el = best === null ? null : elementOf(best);
    if (!el) { point(); return; }
    state = 'guess';
    outline(el);
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    show(`Is it this? (${targetLabel(buildTarget(el))})`, [['Yes', () => pick(el), true], ['No, I’ll point at it', () => point()], ['Cancel', () => offer()]]);
  }

  // ── Pointing: the next click picks an element and doesn't reach the app ──
  const ours = (e: Event) => e.target === host || (e.composedPath?.() ?? []).includes(host);
  const under = (e: Event): Element | null => {
    const t = e.target as Element | null;
    if (!t || ours(e) || typeof t.closest !== 'function' || t.closest('[data-trace-avatar], [data-trace-ignore]')) return null;
    return wait ? t : meaningful(t);
  };
  const block = (e: Event) => { if (!ours(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  const onMove = (e: Event) => { const el = under(e); if (el) outline(el); };
  const onClick = (e: Event) => {
    if (ours(e)) return;
    block(e);
    const el = under(e);
    if (el) { if (wait) setText((el.textContent ?? '').replace(/\s+/g, ' ').trim()); else pick(el); }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); offer(); } };
  const PRESS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'touchend', 'auxclick', 'dblclick'] as const;
  let pointing = false;
  function point() {
    state = 'point';
    outline(null);
    show(wait ? 'Click the text this step should wait for. Esc to cancel.' : 'Click the element this step should use. Esc to cancel.', [['Cancel', () => offer()]]);
    if (pointing) return;
    pointing = true;
    doc.addEventListener('mouseover', onMove, true);
    doc.addEventListener('click', onClick, true);
    for (const t of PRESS) doc.addEventListener(t, block, true);
    doc.addEventListener('keydown', onKey, true);
  }
  function stopPointing() {
    if (!pointing) return;
    pointing = false;
    doc.removeEventListener('mouseover', onMove, true);
    doc.removeEventListener('click', onClick, true);
    for (const t of PRESS) doc.removeEventListener(t, block, true);
    doc.removeEventListener('keydown', onKey, true);
  }

  function pick(el: Element) {
    const target = buildTarget(el);
    if (!resolvesTo(target, el, doc)) {
      if (state !== 'point') point();
      show('That can’t be told apart from other things here. Point at something more specific. Esc to cancel.', [['Cancel', () => offer()]]);
      return;
    }
    const next: Trace = JSON.parse(JSON.stringify(trace));
    next.steps[o.index] = { ...next.steps[o.index], target };
    done(next, o.index, `Fixed step ${n}: ${targetLabel(target)}.`);
  }

  async function save() {
    if (!o.save) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = `${o.entry.id}.trace.json`;
      doc.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      show(`Downloaded ${o.entry.id}.trace.json, fixed.`, [['Close', () => close(), true]]);
      return;
    }
    show('Saving…', []);
    try {
      await o.save(trace, o.entry, { from: o.entry.id });
      show('Saved: the guide is fixed for everyone.', [['Close', () => close(), true]]);
    } catch (e) {
      show(`Could not save: ${(e as Error)?.message ?? e}`, [['Try again', () => void save(), true], ['Close', () => close()]]);
    }
  }

  function close() {
    if (state === 'closed') return;
    state = 'closed';
    stopPointing();
    if (raf) win.cancelAnimationFrame(raf);
    host.remove();
  }

  offer();
  return {
    get state() { return state; },
    close,
  };
}
