/**
 * Finding a step's element on the live page.
 *
 * Chain of responsibility: CSS selector → role + accessible name → visible
 * text → recorded pixels. The first *usable* match wins. Found elements are
 * cached, but the cache is checked every frame before it is trusted:
 * frameworks swap DOM nodes on re-render, so a cached node may be a detached
 * copy of the real one.
 */

import type { NStep, NormalisedTrace, Target } from '../core/format';
import type { Look, LookFn, ResolvedBy, Viewport } from '../core/player';
import type { Locator, PagePort, SeenText } from './ports';

const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const ROLE_SELECTORS: Record<string, string> = {
  button: 'button,[role=button],input[type=button],input[type=submit],input[type=reset],summary',
  link: 'a[href],[role=link]',
  textbox: 'input:not([type]),input[type=text],input[type=email],input[type=search],input[type=tel],input[type=url],input[type=password],input[type=number],textarea,[role=textbox],[contenteditable=""],[contenteditable=true]',
  searchbox: 'input[type=search],[role=searchbox]',
  checkbox: 'input[type=checkbox],[role=checkbox]',
  radio: 'input[type=radio],[role=radio]',
  combobox: 'select,[role=combobox]',
  option: 'option,[role=option]',
  heading: 'h1,h2,h3,h4,h5,h6,[role=heading]',
  img: 'img,[role=img]',
  listitem: 'li,[role=listitem]',
  tab: '[role=tab]',
  menuitem: '[role=menuitem]',
  switch: '[role=switch]',
  slider: 'input[type=range],[role=slider]',
};

const cssEscape = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\\]]/g, '\\$&'));

/** The accessible name, close enough for matching: aria-label, labelledby, label, alt, placeholder, title, text. */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const doc = el.ownerDocument;
    const text = by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent || '').join(' ').trim();
    if (text) return text;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) return Array.from(labels).map((l) => l.textContent || '').join(' ');
  if (el instanceof HTMLImageElement && el.alt) return el.alt;
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
  const ph = el.getAttribute('placeholder');
  if (ph) return ph;
  const text = el.textContent || '';
  if (text.trim()) return text;
  return el.getAttribute('title') || '';
}

/** Specification shared by resolution, `wait` and (later) perform mode. */
export function isUsable(el: Element, rect?: DOMRect): boolean {
  if (!el.isConnected) return false;
  const r = rect ?? el.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return false;
  const cv = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (cv) return cv.call(el, { visibilityProperty: true });
  const st = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !st || (st.visibility !== 'hidden' && st.display !== 'none');
}

const firstUsable = (list: Iterable<Element>, ok: (el: Element) => boolean = () => true): Element | null => {
  for (const el of list) if (ok(el) && isUsable(el)) return el;
  return null;
};

export const bySelector: Locator = (t, root) => {
  if (!t.sel) return null;
  try { return firstUsable(root.querySelectorAll(t.sel)); } catch { return null; }
};

export const byRoleAndName: Locator = (t, root) => {
  if (!t.role) return null;
  const sel = ROLE_SELECTORS[t.role] ?? `[role="${cssEscape(t.role)}"]`;
  let list: Element[];
  try { list = Array.from(root.querySelectorAll(sel)); } catch { return null; }
  if (!t.name) return firstUsable(list);
  const want = norm(t.name);
  return firstUsable(list, (el) => norm(accessibleName(el)) === want)
    ?? firstUsable(list, (el) => norm(accessibleName(el)).includes(want));
};

export const byText: Locator = (t, root) => {
  if (!t.text) return null;
  const want = norm(t.text);
  if (!want) return null;
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const contains: Element[] = [];
  let seen = 0;
  for (let node = walker.nextNode(); node && seen < 5000; node = walker.nextNode(), seen += 1) {
    const value = norm(node.nodeValue);
    // The text may be split across inline tags ("New <b>invoice</b>"): a piece of it counts too.
    if (!value || !(value.includes(want) || want.includes(value))) continue;
    const el = node.parentElement;
    if (!el || el.closest('[data-trace-avatar]')) continue;
    // Climb to the smallest element whose whole text is the wanted text.
    let cur: Element | null = el;
    for (let k = 0; cur && k < 4; k += 1, cur = cur.parentElement) {
      if (norm(cur.textContent) === want) {
        if (isUsable(cur)) return cur;
        break;
      }
    }
    if (norm(el.textContent).includes(want)) contains.push(el);
  }
  return firstUsable(contains);
};

export const DEFAULT_LOCATORS: readonly Locator[] = [bySelector, byRoleAndName, byText];
const KIND: Map<Locator, ResolvedBy> = new Map([[bySelector, 'sel'], [byRoleAndName, 'role'], [byText, 'text']]);

export interface PageOptions {
  root?: ParentNode;
  /** Extra locators, tried before the defaults. */
  locators?: Locator[];
  win?: Window;
}

/** How often a `wait … until` is checked at most (ms): text across a page is too costly per frame. */
export const UNTIL_MS = 250;

export function createPage(opts: PageOptions = {}): PagePort {
  const win = opts.win ?? window;
  const root: ParentNode = opts.root ?? win.document;
  const chain: Locator[] = [...(opts.locators ?? []), ...DEFAULT_LOCATORS];
  const cache = new Map<number, { ref: WeakRef<Element>; by: ResolvedBy }>();
  // `until` answers, rechecked only when the page changed and UNTIL_MS has passed.
  const untilMemo = new Map<number, { met: boolean; at: number; seen: number }>();
  /** Bumped by every page change the observer sees; each answer remembers the version it saw. */
  let version = 0;
  let observer: MutationObserver | null = null;
  /**
   * Short texts the page showed, with when, while a guide with `until` waits plays (the app's answer often
   * shows before the wait starts asking). Visibility is checked when read, never here: no layout in the observer.
   */
  let log: Array<{ element: Element; text: string; at: number }> = [];
  let noting = false;
  let waitingFor = -1;
  let waitStart = 0;
  const note = (records: MutationRecord[]) => {
    for (const r of records.slice(0, 50)) {
      for (const n of r.type === 'childList' ? Array.from(r.addedNodes).slice(0, 10) : [r.target]) {
        const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
        if (!el || el.childElementCount > 10 || el.closest('[data-trace-avatar]')) continue;
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text.length >= 2 && text.length <= 60) log = [{ element: el, text, at: Date.now() }, ...log].slice(0, 30);
      }
    }
  };
  const watch = () => {
    const MO = (win as Window & typeof globalThis).MutationObserver;
    if (observer || typeof MO !== 'function') return;
    const mo = new MO((records) => { version += 1; if (noting) note(records); });
    mo.observe(root as Node, { subtree: true, childList: true, characterData: true, attributes: true });
    observer = mo;
  };

  /** Whether step's until holds right now (no memo). */
  function untilNow(step: NStep): boolean {
    const u = step.until;
    if (!u) return true;
    if (u.gone) return !resolve(step);
    const want = norm(u.text);
    if (!step.target) return !!byText({ text: u.text }, root, step);
    const found = resolve(step);
    return !!found && norm(found.el.textContent).includes(want);
  }

  function resolve(step: NStep): { el: Element; by: ResolvedBy } | null {
    const t = step.target as Target;
    const hit = cache.get(step.i);
    const cached = hit?.ref.deref();
    if (cached && isUsable(cached)) return { el: cached, by: hit!.by };
    for (const loc of chain) {
      const el = loc(t, root, step);
      if (el) {
        const by = KIND.get(loc) ?? 'sel';
        cache.set(step.i, { ref: new WeakRef(el), by });
        return { el, by };
      }
    }
    cache.delete(step.i);
    return null;
  }

  return {
    viewport: () => ({ w: win.innerWidth, h: win.innerHeight }),
    element: (i) => cache.get(i)?.ref.deref() ?? null,
    until(trace, now) {
      watch();
      noting = trace.steps.some((s) => s.until);
      return (i) => {
        const step = trace.steps[i];
        if (!step?.until) return true;
        if (waitingFor !== i) { waitingFor = i; waitStart = Date.now(); }
        const memo = untilMemo.get(i);
        // Recheck when first asked, or when UNTIL_MS has passed and the page changed (or can't be watched).
        if (memo && !(now - memo.at >= UNTIL_MS && (memo.seen !== version || !observer))) return memo.met;
        const met = untilNow(step);
        untilMemo.set(i, { met, at: now, seen: version });
        return met;
      };
    },
    // From 2 s before the wait began, newest first: still shown, or come and gone (a toast).
    seen: () => {
      const out: SeenText[] = [];
      for (const { element: el, text, at } of log) {
        if (waitingFor < 0 || at < waitStart - 2000 || out.length >= 20 || out.some((o) => o.text === text)) continue;
        // Gone, or changed since (it came and went), or still shown. Text that was never visible doesn't count.
        if (!el.isConnected || norm(el.textContent) !== norm(text) || isUsable(el)) out.push({ text, element: el });
      }
      return out;
    },
    clear: () => { cache.clear(); untilMemo.clear(); observer?.disconnect(); observer = null; log = []; waitingFor = -1; },
    looker(trace: NormalisedTrace, vp: Viewport): LookFn {
      const memo = new Map<number, Look | null>();
      const rec = trace.meta.viewport;
      return (i) => {
        if (memo.has(i)) return memo.get(i)!;
        const step = trace.steps[i];
        let out: Look | null = null;
        if (step?.target) {
          const found = resolve(step);
          if (found) {
            const r = found.el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            out = { x: r.left, y: r.top, w: r.width, h: r.height, by: found.by, inView: cx >= 0 && cy >= 0 && cx <= vp.w && cy <= vp.h };
          } else if (step.target.xy) {
            const sx = rec ? vp.w / rec.w : 1;
            const sy = rec ? vp.h / rec.h : 1;
            out = { x: step.target.xy.x * sx, y: step.target.xy.y * sy, w: 0, h: 0, by: 'xy', inView: true };
          }
        }
        memo.set(i, out);
        return out;
      };
    },
  };
}
