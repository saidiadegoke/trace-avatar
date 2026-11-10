/**
 * The studio: record a guide inside the app, then review it and save it, without touching JSON.
 *
 *   toolbar (while recording)  ● 0:42 · 7 steps  Pause  + Caption  Wait for…  Mask/Reveal  ■ Stop
 *   review panel (after Stop)  title, id, modes, pages; each step's caption, order, checkpoint, pause;
 *                              Play Show me / Do it for me; Save · Download · Copy JSON; Advanced JSON
 *
 * Recording and review both carry on across full page loads (sessionStorage), so a guide can span
 * pages and a Do it for me test play can navigate. Everything lives in one shadow root marked
 * data-trace-avatar, which the recorder ignores. Saving is the app's job (`save`); the default is a
 * download.
 */

import { createRecorder } from '../shell/recorder.dom';
import type { Recorder, RecorderOptions } from '../shell/recorder.dom';
import { parse } from '../core/format';
import type { Avatar, NormalisedTrace, Step, Trace } from '../core/format';
import { GUIDE_ID } from '../core/manifest';
import type { Guide, GuideMode } from '../core/manifest';
import { isSecret } from '../core/mask';
import { compactPages, entryOf, expandPages, guideId, moveStep, pagesOf, removeStep, stepLabel } from '../core/review';
import type { EntryDraft } from '../core/review';
import { STUDIO_PERSIST, STUDIO_REVIEW_KEY } from '../core/studio-keys';
import type { Ai, Suggestion } from '../core/assist';
import type { AssistUi, AssistUiHost } from './assist-ui';
import { createEmitter } from '../shell/emitter';
import { factsOf } from '../shell/recorder.dom';
import type { PrepareResult, TraceController, TraceOptions } from '../index';

/** What a save is: `from` is the id of the saved guide the author opened (edit, Fix this step); absent when new. */
export interface SaveInfo { from?: string }

export interface StudioPlayer { createTrace(o: TraceOptions): TraceController }
export interface StudioLoaders {
  player(): Promise<StudioPlayer>;
  /** The "Suggest" section, loaded when an author first opens it (only with `ai`). */
  assist?(): Promise<{ createAssistUi(host: AssistUiHost): AssistUi }>;
}

export interface StudioOptions {
  doc?: Document;
  /**
   * Where a saved guide goes: your API, a CMS, a pull request. Default: download the .trace.json.
   * `info.from` is the id of the saved guide this one was opened from (`edit`); absent for a new recording.
   */
  save?: (trace: Trace, entry: Guide, info: SaveInfo) => void | Promise<void>;
  /** Copied to meta.requires (e.g. ['signed-in']). */
  requires?: string[];
  /** Mask typed text unless a field is revealed. Default true. */
  maskByDefault?: boolean;
  avatar?: Avatar;
  /** Offer Do it for me (the mode, and its test play). Default true. */
  perform?: boolean;
  navigate?: (path: string) => void;
  prepare?: (requires: string[], trace: NormalisedTrace) => PrepareResult | Promise<PrepareResult>;
  onReset?: () => void | Promise<void>;
  currentPath?: () => string;
  /** The author closed the studio. */
  onClose?: () => void;
  /** Passed to the recorder (tests: allowSynthetic, now, wall). */
  recorder?: Partial<RecorderOptions>;
  /**
   * AI suggestions in the review (captions, waits, a title), which the author accepts one by one. A function that
   * calls your backend (never a model key in the page). See trace-avatar/assist.
   */
  ai?: Ai;
}

export type StudioState = 'idle' | 'recording' | 'paused' | 'review' | 'testing' | 'closed';

export interface StudioEvents extends Record<string, unknown> {
  state: { state: StudioState };
  save: { trace: Trace; entry: Guide };
  close: void;
}

export interface Studio {
  readonly state: StudioState;
  readonly host: HTMLElement;
  /** The guide in review, as it stands. */
  readonly trace: Trace | null;
  readonly entry: Guide | null;
  /** Start recording. */
  start(): void;
  /** Stop recording and open the review. */
  stop(): void;
  /** Open a saved guide in the review, to change it. Its save carries `{ from: entry.id }`. */
  edit(trace: Trace, entry: { id: string; title?: string; modes?: GuideMode[]; pages?: string[] }): void;
  on<K extends keyof StudioEvents>(ev: K, fn: (d: StudioEvents[K]) => void): () => void;
  destroy(): void;
}

interface Kept {
  trace: Trace; draft: EntryDraft; idEdited?: boolean; testing?: GuideMode;
  /** What appeared after each step (parallel to trace.steps), for AI wait suggestions. Never saved. */
  hints?: string[][];
  /** The saved guide this was opened from (edit). */
  from?: string;
}

const SEEN_KEY = 'trace-avatar:studio:seen';
const TEST_KEY = 'studio:test';

export const STUDIO_CSS = `
:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:var(--ta-z,2147483000);
--c:var(--ta-color,#2456d8);--bb:var(--ta-badge-bg,#111827);--bf:var(--ta-badge-fg,#f9fafb);--f:var(--ta-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
@media (prefers-color-scheme:dark){:host{--bb:var(--ta-badge-bg,#f9fafb);--bf:var(--ta-badge-fg,#111827)}}
*{box-sizing:border-box}
[hidden]{display:none!important}
button{all:unset;cursor:pointer;font:500 13px/1.2 var(--f);padding:6px 10px;border-radius:999px;background:color-mix(in srgb,var(--bf) 12%,transparent)}
button:hover{background:color-mix(in srgb,var(--bf) 22%,transparent)}
button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--c);outline-offset:2px}
button.go{background:var(--c);color:#fff}
button:disabled{opacity:.45;cursor:default}
input,textarea{font:13px/1.4 var(--f);color:inherit;background:color-mix(in srgb,var(--bf) 8%,transparent);border:1px solid color-mix(in srgb,var(--bf) 25%,transparent);border-radius:8px;padding:6px 8px;width:100%}
input[type=checkbox]{width:auto}
.bar,.panel,.tip{pointer-events:auto;background:var(--bb);color:var(--bf);font:13px/1.4 var(--f);box-shadow:0 10px 30px rgb(0 0 0/.25)}
.bar{position:absolute;bottom:12px;left:12px;border-radius:14px;padding:8px;display:flex;flex-direction:column;gap:6px;max-width:calc(100vw - 24px)}
.bar.top{bottom:auto;top:12px}
.row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dot{width:10px;height:10px;border-radius:50%;background:#e5484d;display:inline-block}
.paused .dot{background:#f5a524}
.tip{position:absolute;top:120px;left:50%;transform:translateX(-50%);border-radius:12px;padding:10px 12px;max-width:min(420px,calc(100vw - 24px))}
.box{position:absolute;border:2px solid var(--c);border-radius:4px;background:color-mix(in srgb,var(--c) 12%,transparent)}
.panel{position:absolute;top:0;right:0;bottom:0;width:min(400px,100vw);overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
h2{font:600 16px/1.3 var(--f);margin:0;flex:1}
label{display:flex;flex-direction:column;gap:3px;font-weight:600}
label.c{flex-direction:row;align-items:center;gap:5px;font-weight:400}
ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
li{padding:8px;border-radius:10px;background:color-mix(in srgb,var(--bf) 6%,transparent);display:flex;flex-direction:column;gap:6px}
small{opacity:.7;font-weight:400}
.err{color:#f87171;margin:0}.st{margin:0}
textarea{min-height:160px;font-family:ui-monospace,monospace}
`;

type Kid = Node | string | null | false | undefined;

export function createStudio(opts: StudioOptions, loaders: StudioLoaders): Studio {
  const doc = opts.doc ?? document;
  const win = doc.defaultView ?? window;
  const emitter = createEmitter<StudioEvents>();
  const performOk = opts.perform !== false;
  const ss = {
    get(): Kept | null { try { const v = JSON.parse(win.sessionStorage.getItem(STUDIO_REVIEW_KEY) ?? 'null'); return v && v.trace && v.draft ? v : null; } catch { return null; } },
    set(v: Kept) { try { win.sessionStorage.setItem(STUDIO_REVIEW_KEY, JSON.stringify(v)); } catch { /* storage off */ } },
    clear() { try { win.sessionStorage.removeItem(STUDIO_REVIEW_KEY); } catch { /* storage off */ } },
  };

  // A tiny element builder: h('button', { class: 'go', onclick }, 'Save').
  const h = (tag: string, a: Record<string, unknown> = {}, ...kids: Kid[]): HTMLElement => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
      else if (k in el && k !== 'style') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
    for (const c of kids) if (c) el.append(c);
    return el;
  };

  const host = h('div', { 'data-trace-avatar': 'studio' });
  const root = host.attachShadow({ mode: 'open' });
  const style = h('style');
  style.textContent = STUDIO_CSS;
  const bar = h('div', { className: 'bar', role: 'toolbar', 'aria-label': 'Recording a guide', hidden: true });
  const tip = h('div', { className: 'tip', role: 'note', hidden: true });
  const box = h('div', { className: 'box', hidden: true });
  const panel = h('aside', { className: 'panel', role: 'dialog', 'aria-label': 'Review the guide', hidden: true });
  root.append(style, box, bar, tip, panel);
  (doc.body ?? doc.documentElement).appendChild(host);

  let state: StudioState = 'idle';
  let rec: Recorder | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let kept: Kept | null = null;
  let test: TraceController | null = null;
  let player: Promise<StudioPlayer> | null = null;

  const set = (s: StudioState) => { if (state !== s) { state = s; emitter.emit('state', { state }); } };

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const time = h('span', { 'aria-live': 'off' });
  const pauseBtn = h('button', { onclick: () => { if (!rec) return; if (rec.state === 'paused') rec.resume(); else rec.pause(); tick(); } });
  const sub = h('div', { className: 'row', role: 'status' });
  const say = (text: string) => { sub.textContent = text; };
  bar.append(
    h('div', { className: 'row' },
      h('span', { className: 'dot', 'aria-hidden': 'true' }), time,
      pauseBtn,
      h('button', { onclick: captionForm }, '+ Caption'),
      h('button', { onclick: () => startPick('Click what to wait for · Esc cancels', waitChoice) }, 'Wait for…'),
      h('button', { onclick: () => startPick('Click a field to mask or reveal · Esc cancels', maskChoice) }, 'Mask / Reveal'),
      h('button', { className: 'go', onclick: () => stop() }, '■ Stop'),
      h('button', { 'aria-label': 'Move the bar to the other edge', onclick: () => bar.classList.toggle('top') }, '⇅')),
    sub,
  );

  function tick() {
    if (!rec) return;
    const s = Math.floor(rec.elapsed / 1000);
    const n = rec.count;
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${n} step${n === 1 ? '' : 's'}`;
    const paused = rec.state === 'paused';
    bar.classList.toggle('paused', paused);
    pauseBtn.textContent = paused ? '▶ Resume' : '❚❚ Pause';
    set(paused ? 'paused' : 'recording');
  }

  function captionForm() {
    sub.textContent = '';
    const input = h('input', { 'aria-label': 'Caption for the last step', placeholder: 'Caption for the last step' }) as HTMLInputElement;
    const add = () => { rec?.caption(input.value); say(input.value.trim() ? 'Caption added.' : ''); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); else if (e.key === 'Escape') say(''); });
    sub.append(input, h('button', { className: 'go', onclick: add }, 'Add'), h('button', { onclick: () => say('') }, 'Cancel'));
    input.focus();
  }

  function waitChoice(el: Element) {
    sub.textContent = '';
    const now = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const input = h('input', { 'aria-label': 'Text to wait for', value: now }) as HTMLInputElement;
    sub.append(
      input,
      h('button', { className: 'go', onclick: () => { const t = input.value.trim(); if (!t) return; rec?.waitFor(el, { text: t }); say(`Waits for "${t}".`); tick(); } }, 'Until it shows this'),
      h('button', { onclick: () => { rec?.waitFor(el, { gone: true }); say('Waits until it is gone.'); tick(); } }, 'Until it is gone'),
      h('button', { onclick: () => say('') }, 'Cancel'),
    );
    input.focus();
  }

  function maskChoice(picked: Element) {
    sub.textContent = '';
    const el = picked.closest('input,textarea,select,[contenteditable]');
    if (!el) { say('That is not a field. Pick a text field.'); return; }
    const secret = isSecret(factsOf(el));
    const mark = (how: 'mask' | 'reveal') => {
      const masked = rec?.mark(el, how) ?? true;
      say(how === 'reveal' && masked ? 'Always masked: passwords, card numbers and codes are never kept.' : masked ? 'Masked: only its length is kept.' : 'Revealed: its text is kept in the guide.');
    };
    sub.append(
      h('span', {}, secret ? 'This field is always masked.' : 'Typed text in this field:'),
      h('button', { onclick: () => mark('mask') }, 'Mask'),
      h('button', { onclick: () => mark('reveal'), disabled: secret }, 'Reveal'),
    );
  }

  // ── Picker: the next click chooses an element (and does nothing in the app) ────────────
  let picking: ((el: Element) => void) | null = null;
  const ours = (e: Event) => e.composedPath().includes(host);
  const PICK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'];
  const onPickEvent = (e: Event) => {
    if (!picking || ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    const done = picking;
    endPick();
    done(e.target as Element);
  };
  const onPickMove = (e: Event) => {
    const el = e.target as Element;
    if (!picking || ours(e) || !el?.getBoundingClientRect) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    box.hidden = false;
  };
  const onPickKey = (e: KeyboardEvent) => { if (picking && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endPick(); say(''); } };
  function startPick(hint: string, then: (el: Element) => void) {
    endPick();
    picking = then;
    say(hint);
    for (const t of PICK_EVENTS) win.addEventListener(t, onPickEvent, true);
    win.addEventListener('pointermove', onPickMove, true);
    win.addEventListener('keydown', onPickKey, true);
  }
  function endPick() {
    picking = null;
    box.hidden = true;
    for (const t of PICK_EVENTS) win.removeEventListener(t, onPickEvent, true);
    win.removeEventListener('pointermove', onPickMove, true);
    win.removeEventListener('keydown', onPickKey, true);
  }

  function firstTime() {
    let seen = false;
    try { seen = !!win.localStorage.getItem(SEEN_KEY); } catch { /* storage off */ }
    if (seen) return;
    tip.textContent = '';
    tip.append(
      h('p', { style: 'margin:0 0 8px' }, 'Recording. Typed text is masked unless you reveal a field. Nothing leaves this page until you save.'),
      h('button', { className: 'go', onclick: () => { tip.hidden = true; try { win.localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage off */ } } }, 'Got it'),
    );
    tip.hidden = false;
  }

  // ── Recording ──────────────────────────────────────────────────────────────
  const makeRecorder = () => {
    const r = createRecorder({
      persistKey: STUDIO_PERSIST,
      ...(opts.requires ? { requires: opts.requires } : {}),
      ...(opts.maskByDefault !== undefined ? { maskByDefault: opts.maskByDefault } : {}),
      ...(opts.avatar ? { avatar: opts.avatar } : {}),
      doc,
      ...opts.recorder,
    });
    r.on('draft', () => { if (rec === r) tick(); });
    return r;
  };
  function showBar() {
    bar.hidden = false;
    panel.hidden = true;
    tick();
    timer ??= setInterval(tick, 500);
  }
  function hideBar() {
    endPick();
    bar.hidden = true;
    tip.hidden = true;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function start() {
    if (state === 'recording' || state === 'paused' || state === 'closed') return;
    stopTest();
    ss.clear();
    kept = null;
    rec?.destroy();
    rec = makeRecorder();
    rec.start();
    say('');
    showBar();
    firstTime();
  }

  function stop() {
    if (!rec || (state !== 'recording' && state !== 'paused')) return;
    const trace = rec.stop();
    const seen = rec.hints;
    rec.destroy();
    rec = null;
    hideBar();
    if (!trace) { kept = null; review(null); return; }
    const title = trace.meta?.title ?? '';
    const steps = expandPages(trace.steps);
    const hints = steps.map(() => [] as string[]);
    for (const x of seen) if (hints[x.after]) hints[x.after] = x.texts;
    kept = { trace: { ...trace, steps }, draft: { id: guideId(title), title, modes: performOk ? ['overlay', 'perform'] : ['overlay'], pages: pagesOf(steps).slice(0, 1) }, hints };
    ss.set(kept);
    review(kept);
  }

  function edit(trace: Trace, e: { id: string; title?: string; modes?: GuideMode[]; pages?: string[] }) {
    if (state === 'closed') return;
    const p = parse(trace);
    if (!p.ok) throw new Error(`not a valid trace: ${p.errors.map((x) => `${x.path || 'trace'} ${x.message}`).join('; ')}`);
    stopTest();
    rec?.destroy();
    rec = null;
    hideBar();
    const copy: Trace = JSON.parse(JSON.stringify(trace));
    const steps = expandPages(copy.steps);
    const title = e.title ?? copy.meta?.title ?? '';
    const modes = (e.modes?.length ? e.modes : ['overlay']).filter((m) => m === 'overlay' || performOk) as GuideMode[];
    kept = { trace: { ...copy, steps }, draft: { id: e.id, title, modes, pages: e.pages ? [...e.pages] : [] }, idEdited: true, from: e.id };
    ss.set(kept);
    review(kept);
  }

  // ── Review ─────────────────────────────────────────────────────────────────
  /** The trace as the author has it now (pages compacted again, title from the form). */
  const current = (): Trace | null => {
    if (!kept) return null;
    const t = kept.trace;
    const meta = { ...t.meta, ...(kept.draft.title.trim() ? { title: kept.draft.title.trim() } : {}) };
    return { ...t, meta, steps: compactPages(t.steps) };
  };
  const problems = (): string[] => {
    const t = current();
    if (!t) return ['Nothing to save.'];
    const out: string[] = [];
    if (!kept!.draft.title.trim()) out.push('Give the guide a title.');
    if (!GUIDE_ID.test(kept!.draft.id)) out.push('The id: letters, digits, - and _.');
    if (!t.steps.length) out.push('The guide has no steps.');
    const p = parse(t);
    if (!p.ok) out.push(...p.errors.map((e) => `${e.path || 'trace'}: ${e.message}`));
    return out;
  };

  let errEl: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let actions: HTMLButtonElement[] = [];
  const check = () => {
    const p = problems();
    if (errEl) errEl.textContent = p.join(' ');
    for (const b of actions) b.disabled = p.length > 0;
    return p.length === 0;
  };
  const changed = (rerender = false) => { if (kept) ss.set(kept); if (rerender) review(kept); else check(); };

  const swapHints = (k: Kept, a: number, b: number) => {
    const x = k.hints;
    if (x && x[a] && x[b]) [x[a], x[b]] = [x[b], x[a]];
  };

  // ── AI suggestions (only with opts.ai; the section loads on first use) ─────────
  let assistUi: AssistUi | null = null;
  const acceptSuggestion = (k: Kept, sg: Suggestion) => {
    const steps = k.trace.steps;
    if (sg.kind === 'say' && steps[sg.index]) steps[sg.index].say = sg.value;
    else if (sg.kind === 'title') { k.draft.title = sg.value; if (!k.idEdited) k.draft.id = guideId(sg.value); }
    else if (sg.kind === 'wait') {
      const page = steps[sg.index]?.page;
      steps.splice(sg.index + 1, 0, { type: 'wait', until: { text: sg.value }, timeout: 15_000, ...(page ? { page } : {}) });
      k.hints?.splice(sg.index + 1, 0, []);
    }
    changed(true);
  };
  function assistBox(): HTMLElement | string {
    const ai = opts.ai;
    if (!ai) return '';
    const box = h('div', { className: 'ai' });
    // Bound to the kept work as it is when called (the review re-renders with the same studio).
    const host: AssistUiHost = {
      h, ai,
      trace: () => current()!,
      hints: () => (kept?.hints ?? []).flatMap((texts, after) => (texts.length ? [{ after, texts }] : [])),
      accept: (sg) => { if (kept) acceptSuggestion(kept, sg); },
    };
    if (assistUi) { assistUi.render(box); return box; }
    if (!loaders.assist) return '';
    const open = h('button', { onclick: async () => {
      open.textContent = 'Loading…';
      try { assistUi ??= (await loaders.assist!()).createAssistUi(host); assistUi.render(box); } catch (e) { open.textContent = `Could not load the AI suggestions: ${(e as Error).message}`; }
    } }, '✨ Suggest captions, waits, a title');
    box.append(open);
    return box;
  }

  function review(k: Kept | null) {
    set('review');
    panel.textContent = '';
    panel.hidden = false;
    const close = h('button', { 'aria-label': 'Close the studio', onclick: () => closeStudio() }, '✕');
    panel.append(h('div', { className: 'row' }, h('h2', {}, k?.from ? 'Edit the guide' : 'Review the guide'), close));
    if (!k) {
      panel.append(h('p', {}, 'Nothing was recorded.'), h('div', { className: 'row' }, h('button', { className: 'go', onclick: () => start() }, '● Record again'), h('button', { onclick: () => closeStudio() }, 'Close')));
      close.focus();
      return;
    }
    const d = k.draft;
    const field = (label: string, value: string, on: (v: string) => void, hint?: string) => {
      const input = h('input', { value, oninput: (e: Event) => on((e.target as HTMLInputElement).value) });
      return h('label', {}, label, input, hint ? h('small', {}, hint) : null);
    };
    const idWrap = field('Id', d.id, (v) => { d.id = v.trim(); k.idEdited = true; changed(); }, 'Used in links: ?trace=id');
    const idInput = idWrap.querySelector('input')!;
    panel.append(
      field('Title', d.title, (v) => { d.title = v; if (!k.idEdited) { d.id = guideId(v); idInput.value = d.id; } changed(); }),
      idWrap,
      h('fieldset', { style: 'border:0;padding:0;margin:0;display:flex;gap:12px' }, h('legend', { style: 'font-weight:600;padding:0;margin-bottom:4px' }, 'Offer'),
        ...(['overlay', 'perform'] as GuideMode[]).filter((m) => m === 'overlay' || performOk).map((m) => h('label', { className: 'c' },
          h('input', { type: 'checkbox', checked: d.modes.includes(m), onchange: (e: Event) => {
            d.modes = (e.target as HTMLInputElement).checked ? Array.from(new Set([...d.modes, m])) : d.modes.filter((x) => x !== m);
            changed();
          } }),
          m === 'perform' ? 'Do it for me' : 'Show me'))),
      field('Pages it is listed on', d.pages.join(', '), (v) => { d.pages = v.split(',').map((s) => s.trim()).filter(Boolean); changed(); }, 'Comma separated; * matches one part. Empty: every page.'),
    );

    const steps = k.trace.steps;
    const list = h('ol', { 'aria-label': 'Steps' });
    steps.forEach((s: Step, i: number) => {
      const n = i + 1;
      const flag = (name: 'checkpoint' | 'pause', label: string) => h('label', { className: 'c' },
        h('input', { type: 'checkbox', checked: !!s[name], onchange: (e: Event) => {
          if ((e.target as HTMLInputElement).checked) s[name] = true; else delete s[name];
          changed();
        } }), label);
      list.append(h('li', {},
        h('div', {}, `${n}. ${stepLabel(s)} `, s.page ? h('small', {}, s.page) : null),
        h('input', { value: s.say ?? '', placeholder: 'Caption', 'aria-label': `Caption for step ${n}`, oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          if (v.trim()) s.say = v; else if (s.type !== 'note') delete s.say; else s.say = v;
          changed();
        } }),
        h('div', { className: 'row' },
          h('button', { 'aria-label': `Move step ${n} up`, disabled: i === 0, onclick: () => { k.trace.steps = moveStep(steps, i, -1); swapHints(k, i, i - 1); changed(true); } }, '↑'),
          h('button', { 'aria-label': `Move step ${n} down`, disabled: i === steps.length - 1, onclick: () => { k.trace.steps = moveStep(steps, i, 1); swapHints(k, i, i + 1); changed(true); } }, '↓'),
          h('button', { 'aria-label': `Delete step ${n}`, onclick: () => { k.trace.steps = removeStep(steps, i); k.hints?.splice(i, 1); changed(true); } }, '✕'),
          flag('checkpoint', 'Checkpoint'), flag('pause', 'Pause here')),
      ));
    });

    errEl = h('p', { className: 'err', role: 'alert' });
    statusEl = h('p', { className: 'st', role: 'status' });
    const playShow = h('button', { className: 'go', onclick: () => void testPlay('overlay') }, '▶ Show me') as HTMLButtonElement;
    const playDo = performOk ? h('button', { onclick: () => void testPlay('perform') }, '▶ Do it for me') as HTMLButtonElement : null;
    const saveBtn = h('button', { className: 'go', onclick: () => void doSave() }, opts.save ? 'Save' : 'Save (download)') as HTMLButtonElement;
    const dl = h('button', { onclick: () => download() }, 'Download') as HTMLButtonElement;
    const cp = h('button', { onclick: () => void copy() }, 'Copy JSON') as HTMLButtonElement;
    actions = [playShow, ...(playDo ? [playDo] : []), saveBtn, dl, cp];
    const json = h('textarea', { 'aria-label': 'Trace JSON' }) as HTMLTextAreaElement;
    const adv = h('details', { ontoggle: () => { if ((adv as HTMLDetailsElement).open) json.value = JSON.stringify(current(), null, 2); } },
      h('summary', {}, 'Advanced: JSON'), json,
      h('div', { className: 'row', style: 'margin-top:6px' }, h('button', { onclick: () => {
        let raw: unknown;
        try { raw = JSON.parse(json.value); } catch (e) { note(`Not JSON: ${(e as Error).message}`); return; }
        const p = parse(raw);
        if (!p.ok) { note(`Not a valid trace: ${p.errors.map((x) => `${x.path || 'trace'} ${x.message}`).join('; ')}`); return; }
        k.trace = { ...(raw as Trace), steps: expandPages((raw as Trace).steps) };
        delete k.hints;
        changed(true);
      } }, 'Apply JSON')));
    panel.append(
      h('h2', { style: 'font-size:14px' }, `Steps (${steps.length})`), list, assistBox(), errEl,
      h('div', { className: 'row' }, h('span', {}, 'Try it:'), playShow, playDo),
      h('div', { className: 'row' }, saveBtn, dl, cp),
      statusEl, adv,
    );
    check();
  }

  const note = (text: string) => { if (statusEl) statusEl.textContent = text; };
  const entry = (): Guide | null => (kept ? entryOf(kept.draft) : null);

  function download() {
    const t = current();
    if (!t || !check()) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `${kept!.draft.id}.trace.json` });
    doc.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    note(`Downloaded ${kept!.draft.id}.trace.json. Add this to your guides/index.json: ${JSON.stringify(entry())}`);
  }
  async function copy() {
    const t = current();
    if (!t || !check()) return;
    try { await win.navigator.clipboard.writeText(JSON.stringify(t, null, 2)); note('Copied the trace JSON.'); } catch { note('Could not copy: the browser refused. Use Download.'); }
  }
  async function doSave() {
    const t = current();
    const e = entry();
    if (!t || !e || !check()) return;
    if (!opts.save) { download(); emitter.emit('save', { trace: t, entry: e }); return; }
    note('Saving…');
    try {
      await opts.save(t, e, kept?.from ? { from: kept.from } : {});
      note('Saved.');
      emitter.emit('save', { trace: t, entry: e });
    } catch (err) { note(`Could not save: ${(err as Error)?.message ?? err}`); }
  }

  // ── Test play (the player is loaded on first use) ─────────────────────────────
  const loadPlayer = () => (player ??= loaders.player().catch((e) => { player = null; throw e; }));
  function stopTest() {
    const c = test;
    test = null;
    c?.destroy();
    if (kept?.testing) { delete kept.testing; ss.set(kept); }
  }
  async function testPlay(mode: GuideMode, resuming = false) {
    const t = current();
    if (!t || !kept || (!resuming && !check())) return;
    stopTest();
    kept.testing = mode;
    ss.set(kept);
    set('testing');
    panel.hidden = true;
    let mod: StudioPlayer;
    try { mod = await loadPlayer(); } catch (e) { done(`Could not load the player: ${(e as Error).message}`); return; }
    if (state !== 'testing') return;
    let c: TraceController;
    try {
      c = mod.createTrace({
        trace: t, mode, controls: true, autoplay: !resuming, resumeKey: TEST_KEY,
        ...(opts.navigate ? { navigate: opts.navigate } : {}),
        ...(opts.prepare ? { prepare: opts.prepare } : {}),
        ...(opts.onReset ? { onReset: opts.onReset } : {}),
        ...(opts.currentPath ? { currentPath: opts.currentPath } : {}),
        ...(opts.avatar ? { avatar: opts.avatar } : {}),
      });
    } catch (e) { done(`Could not play: ${(e as Error).message}`); return; }
    test = c;
    let started = false;
    c.on('error', (e) => { if (test === c) done(`The guide stopped: ${e.message}`); });
    c.on('end', () => { setTimeout(() => { if (test === c) done('Played to the end.'); }, 1200); });
    c.on('state', ({ phase }) => {
      if (phase !== 'idle') started = true;
      else if (started && test === c) done('Stopped.');
    });
    try { await c.ready; } catch { return; }
    if (resuming) {
      if (c.state === 'paused') c.play(); else if (test === c) done('');
    }
  }
  function done(msg: string) {
    stopTest();
    if (state === 'closed') return;
    review(kept);
    note(msg);
  }

  function closeStudio() {
    if (state === 'closed') return;
    stopTest();
    rec?.destroy();
    rec = null;
    ss.clear();
    kept = null;
    hideBar();
    panel.hidden = true;
    set('closed');
    host.remove();
    emitter.emit('close', undefined);
    opts.onClose?.();
    emitter.clear();
  }

  // ── Carry on from the last page ───────────────────────────────────────────────
  const r0 = makeRecorder();
  if (r0.restored) { rec = r0; showBar(); }
  else {
    r0.destroy();
    kept = ss.get();
    if (kept) {
      kept.trace.steps = expandPages(kept.trace.steps);
      if (kept.testing) void testPlay(kept.testing, true); else review(kept);
    }
  }

  return {
    get state() { return state; },
    host,
    get trace() { return current(); },
    get entry() { return entry(); },
    start,
    stop,
    edit,
    on: (ev, fn) => emitter.on(ev, fn),
    destroy() {
      if (state === 'closed') return;
      // Leaves the kept work alone: the next page (or the next studio) carries on with it.
      const c = test;
      test = null;
      c?.destroy();
      hideBar();
      rec?.destroy({ keep: true });
      rec = null;
      state = 'closed';
      host.remove();
      emitter.clear();
    },
  };
}
