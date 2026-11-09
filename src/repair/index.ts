/**
 * trace-avatar/repair: on a page where a step's element can't be found, list what the step could mean now,
 * and re-record the chosen element as a target (the recorder's own buildTarget), checked against the player's
 * own resolver. The choosing is in trace-avatar/assist (chooseRepair).
 *
 *   const list = candidatesOf(document);           // [{ id, role, name, text, near, key }]
 *   const target = targetFor(choice.id);           // as if a person had just clicked it
 *   resolvesTo(target, elementOf(choice.id));      // the player finds exactly that element
 */

import type { Target } from '../core/format';
import type { SeenText } from '../shell/ports';
import type { Candidate, TextCandidate } from '../core/repair';
import { accessibleName, byText, DEFAULT_LOCATORS, isUsable } from '../shell/page.dom';
import { buildTarget, isEditableTarget, looksGenerated, roleOf } from '../shell/selector.dom';

export type { Candidate, TextCandidate } from '../core/repair';

/** Roles a step acts on. Elements without a role (a label, a focusable div) count when they have a name. */
const ACT_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'slider', 'spinbutton', 'treeitem', 'gridcell', 'row', 'listitem']);
const ACTIONABLE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, label, [role], [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"]), [onclick]';
/**
 * Never offered: the overlay, ignored and blurred areas. Masked areas are offered (a step types into a masked
 * field), but no field's value is ever read.
 */
export const SKIP = '[data-trace-ignore], [data-trace-avatar], [data-trace-blur]';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

let last: Array<Element | null> = [];

/** The closest heading or labelled region around an element. */
function nearOf(el: Element): string | undefined {
  for (let cur = el.parentElement, k = 0; cur && k < 8; cur = cur.parentElement, k += 1) {
    const aria = cur.getAttribute('aria-label');
    if (aria && /^(DIALOG|SECTION|NAV|FORM|ASIDE|HEADER|FOOTER|MAIN)$/.test(cur.tagName) || (aria && cur.hasAttribute('role'))) return clean(aria).slice(0, 60);
    const h = cur.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > header h1, :scope > header h2, :scope > header h3, :scope > [role=heading]');
    if (h && h !== el && !h.contains(el)) return clean(h.textContent).slice(0, 60) || undefined;
  }
  return undefined;
}

/** A field's name is never its value: only its label, aria name, placeholder or title. */
function fieldName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) return Array.from(labels).map((l) => l.textContent || '').join(' ');
  return el.getAttribute('placeholder') || el.getAttribute('title') || '';
}

/**
 * What a step could act on: visible, usable elements outside ignored and blurred areas (and `skip`),
 * in page order, at most `max`. A field's value is never read.
 */
export function candidatesOf(root: ParentNode = document, o: { skip?: string; max?: number } = {}): Candidate[] {
  const skip = o.skip ? `${SKIP}, ${o.skip}` : SKIP;
  const max = o.max ?? 150;
  const out: Candidate[] = [];
  const els: Element[] = [];
  const seen = new Set<Element>();
  for (const el of Array.from(root.querySelectorAll(ACTIONABLE))) {
    if (out.length >= max) break;
    if (seen.has(el) || el.closest(skip) || !isUsable(el)) continue;
    // A label for a field: the field itself is the candidate.
    if (el.tagName === 'LABEL' && (el as HTMLLabelElement).control) continue;
    const editable = isEditableTarget(el);
    const role = roleOf(el) ?? (editable ? 'textbox' : null);
    if (role && !ACT_ROLES.has(role)) continue;
    const name = clean(editable ? fieldName(el) : accessibleName(el)).slice(0, 80);
    if (!role && !name) continue;
    // A control inside a control (a span with a role in a button) is the outer one.
    const outer = el.parentElement?.closest(ACTIONABLE);
    if (outer && seen.has(outer) && !editable) continue;
    seen.add(el);
    const text = editable ? '' : clean(el.textContent).slice(0, 80);
    const id = el.getAttribute('id');
    const key = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy') ?? (id && !looksGenerated(id) ? id : null);
    const near = nearOf(el);
    out.push({ id: els.length, role, name, ...(text && text !== name ? { text } : {}), ...(near ? { near } : {}), ...(key ? { key } : {}) });
    els.push(el);
  }
  last = els;
  return out;
}

/** The element behind a candidate from the last candidatesOf(). */
export const elementOf = (id: number): Element | null => last[id] ?? null;

/** The chosen candidate re-recorded as a target, as if a person had just clicked it. */
export function targetFor(id: number, root?: ParentNode): Target | null {
  const el = elementOf(id);
  return el ? buildTarget(el, root ? { root } : {}) : null;
}

/** Whether the player, given this target, finds exactly `el` (its own resolver: selector, role + name, text). */
export function resolvesTo(target: Target, el: Element | null, root: ParentNode = document): boolean {
  if (!el) return false;
  for (const find of DEFAULT_LOCATORS) {
    const found = find(target, root, undefined as never); // the default locators don't look at the step
    if (found) return found === el;
  }
  return false;
}

/**
 * Never read as text a wait might mean: fields, controls (a wait is for what the app says, not a button's
 * label), masked, ignored and blurred areas, and the guide's own UI.
 */
export const NOT_TEXT = 'input, textarea, select, [contenteditable], button, a[href], label, summary, option, [role=button], [role=link], [role=tab], [role=menuitem], [data-trace-mask], [data-trace-ignore], [data-trace-blur], [data-trace-avatar], script, style, noscript, template';
const INLINE = /^(B|I|EM|STRONG|SPAN|A|SMALL|MARK|CODE|U|S|SUB|SUP|TIME|ABBR|Q)$/;

/**
 * Values that may never be offered, even when the page shows them back: what is in a field that would be
 * masked (every field not marked [data-trace-reveal], and passwords always).
 */
function maskedValues(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('input, textarea'))
    .filter((el) => (el as HTMLInputElement).type === 'password' || !el.closest('[data-trace-reveal]'))
    .map((el) => ((el as HTMLInputElement).value ?? '').trim().toLowerCase())
    .filter((v) => v.length >= 3);
}

/**
 * What a wait could be waiting for now: the short text blocks (2 to 60 characters) inside `scope` (the wait's
 * target, or the page), plus `seen` (texts that showed while it waited, from the stalled event). Seen ones
 * (strings, or the stalled event's `{ text, element }`) come first, marked `recent`; one no longer on the page is `gone` and has no element. Never offered: field
 * values, masked, ignored and blurred areas, the guide's own UI, and any text holding a typed value
 * (`typed`, lower-case) or the value of a masked field.
 */
export function textsOf(scope: ParentNode = document, o: { seen?: ReadonlyArray<string | SeenText>; typed?: readonly string[]; max?: number } = {}): TextCandidate[] {
  const doc = (scope as Node).ownerDocument ?? (scope as Document);
  const banned = [...(o.typed ?? []), ...maskedValues(doc)];
  const ok = (t: string) => t.length >= 2 && t.length <= 60 && !banned.some((v) => t.toLowerCase().includes(v));
  const onPage = new Map<string, Element>();
  const walker = doc.createTreeWalker(scope as Node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(), k = 0; n && k < 5000 && onPage.size < (o.max ?? 150); n = walker.nextNode(), k += 1) {
    let el = n.parentElement;
    if (!el || el.closest(NOT_TEXT) || !isUsable(el)) continue;
    // Inline pieces belong to their block: "Changes <b>saved</b>" is one text (while it stays short, inside the scope).
    for (let k = 0, up = el.parentElement; k < 3 && INLINE.test(el.tagName) && el !== scope && up && (scope as Node).contains(up) && clean(up.textContent).length <= 60; k += 1, up = up.parentElement) el = up;
    const whole = clean(el.textContent);
    const text = whole.length <= 60 ? whole : clean(n.nodeValue);
    if (ok(text) && !onPage.has(text)) onPage.set(text, el);
  }
  const out: TextCandidate[] = [];
  const els: Array<Element | null> = [];
  // A seen text whose element is a field, a control, masked, ignored or blurred is not offered either.
  const seen = (o.seen ?? []).filter((s) => typeof s === 'string' || !s.element.closest(NOT_TEXT)).map((s) => clean(typeof s === 'string' ? s : s.text)).filter(ok);
  for (const t of seen) {
    if (out.some((c) => c.text === t)) continue;
    const el = onPage.get(t) ?? null;
    out.push({ id: out.length, text: t, recent: true, ...(el ? {} : { gone: true }) });
    els.push(el);
  }
  for (const [t, el] of onPage) {
    if (seen.includes(t)) continue;
    out.push({ id: out.length, text: t });
    els.push(el);
  }
  last = els;
  return out;
}

/** Where a wait on `target` looks: its element when the player finds one, else the whole page. */
export function scopeFor(target: Target | undefined, root: ParentNode = document): ParentNode {
  if (target) for (const find of DEFAULT_LOCATORS) { const el = find(target, root, undefined as never); if (el) return el; }
  return root;
}

/** Whether a wait on `target` (or the page, without one) would see `text` now: the player's own check. */
export function untilHolds(text: string, target: Target | undefined, root: ParentNode = document): boolean {
  const want = clean(text).toLowerCase();
  if (!want) return false;
  if (!target) return !!byText({ text }, root, undefined as never);
  for (const find of DEFAULT_LOCATORS) {
    const el = find(target, root, undefined as never);
    if (el) return clean(el.textContent).toLowerCase().includes(want);
  }
  return false;
}
