/**
 * Target builder: describe an element so the player can find it again later,
 * on a page that may have changed.
 *
 * A chain of candidate selectors, most stable first; each must match exactly
 * this one element under `root`. Role + accessible name and visible text are
 * recorded alongside, so the player's own chain has fallbacks.
 */

import type { Target } from '../core/format';
import { accessibleName } from './page.dom';

const TEST_ATTRS = ['data-trace', 'data-testid', 'data-test', 'data-cy', 'data-qa'];

/** Ids that frameworks generate (":r3:", "ember12", "radix-…", hashes, long numbers) change between builds. */
export function looksGenerated(id: string): boolean {
  return /^\d|[:]|^(ember|react|radix|headlessui|mui|rc_|uid|id-?\d)|[a-f0-9]{8,}|\d{4,}/i.test(id);
}

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, (c) => `\\${c}`));
const quote = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;

function unique(sel: string, el: Element, root: ParentNode): boolean {
  try {
    const all = root.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch { return false; }
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag;
}

/** Candidate selectors, most stable first (exported for tests). */
export function candidates(el: Element): string[] {
  const out: string[] = [];
  const tag = el.tagName.toLowerCase();
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) out.push(`[${a}=${quote(v)}]`);
  }
  if (el.id && !looksGenerated(el.id)) out.push(`#${esc(el.id)}`);
  const name = el.getAttribute('name');
  if (name) out.push(`${tag}[name=${quote(name)}]`);
  const aria = el.getAttribute('aria-label');
  if (aria) out.push(`${tag}[aria-label=${quote(aria)}]`);
  const href = el.getAttribute('href');
  if (tag === 'a' && href && href.length <= 80 && !href.includes('?')) out.push(`a[href=${quote(href)}]`);
  return out;
}

/** The shortest unique structural path, anchored at the nearest ancestor with a stable id or test attribute. */
export function pathSelector(el: Element, root: ParentNode): string | null {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 12; depth += 1) {
    parts.unshift(segment(cur));
    const sel = parts.join(' > ');
    if (unique(sel, el, root)) return sel;
    const parent: Element | null = cur.parentElement;
    if (!parent || parent === root || (root as Node).nodeType === 9 && parent === (root as Document).documentElement) break;
    const anchor = candidates(parent).find((c) => unique(c, parent, root));
    if (anchor) {
      const anchored = `${anchor} > ${parts.join(' > ')}`;
      if (unique(anchored, el, root)) return anchored;
    }
    cur = parent;
  }
  const full = parts.join(' > ');
  return unique(full, el, root) ? full : null;
}

export function bestSelector(el: Element, root: ParentNode): string | null {
  for (const c of candidates(el)) if (unique(c, el, root)) return c;
  return pathSelector(el, root);
}

const IMPLICIT: Array<[string, (el: Element) => boolean]> = [
  ['button', (el) => el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type))],
  ['link', (el) => el.tagName === 'A' && el.hasAttribute('href')],
  ['checkbox', (el) => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox'],
  ['radio', (el) => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio'],
  ['slider', (el) => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range'],
  ['combobox', (el) => el.tagName === 'SELECT'],
  ['textbox', (el) => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['', 'text', 'email', 'search', 'tel', 'url', 'password', 'number'].includes((el as HTMLInputElement).type || ''))],
  ['heading', (el) => /^H[1-6]$/.test(el.tagName)],
];

export function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  for (const [role, test] of IMPLICIT) if (test(el)) return role;
  return null;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The element a person meant: climb from an inner icon/span to the control around it. */
export function meaningful(el: Element): Element {
  const control = el.closest('button, a[href], input, select, textarea, summary, label, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], [contenteditable=""], [contenteditable=true]');
  return control ?? el;
}

export interface TargetOptions {
  root?: ParentNode;
  /** Pointer position (viewport px), to record where on the element and a pixel fallback. */
  point?: { x: number; y: number };
}

export function buildTarget(el: Element, opts: TargetOptions = {}): Target {
  const root = opts.root ?? el.ownerDocument;
  const t: Target = {};
  const sel = bestSelector(el, root);
  if (sel) t.sel = sel;
  const role = roleOf(el);
  const name = clean(accessibleName(el));
  if (role && name && name.length <= 80) { t.role = role; t.name = name; }
  const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  const text = clean(el.textContent || '');
  if (!isField && text && text.length <= 60) t.text = text;
  const r = el.getBoundingClientRect();
  if (opts.point) {
    if (r.width > 0 && r.height > 0) {
      const rx = Math.round(((opts.point.x - r.left) / r.width) * 100) / 100;
      const ry = Math.round(((opts.point.y - r.top) / r.height) * 100) / 100;
      if (rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1 && (Math.abs(rx - 0.5) > 0.15 || Math.abs(ry - 0.5) > 0.15)) t.at = { rx, ry };
    }
    t.xy = { x: Math.round(opts.point.x), y: Math.round(opts.point.y) };
  } else if (r.width > 0 || r.height > 0) {
    t.xy = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  return t;
}
