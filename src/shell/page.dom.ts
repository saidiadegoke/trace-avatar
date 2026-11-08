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
import type { Locator, PagePort } from './ports';

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

export function createPage(opts: PageOptions = {}): PagePort {
  const win = opts.win ?? window;
  const root: ParentNode = opts.root ?? win.document;
  const chain: Locator[] = [...(opts.locators ?? []), ...DEFAULT_LOCATORS];
  const cache = new Map<number, { ref: WeakRef<Element>; by: ResolvedBy }>();

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
    clear: () => cache.clear(),
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
