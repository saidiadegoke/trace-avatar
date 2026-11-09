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
import type { Candidate } from '../core/repair';
import { accessibleName, DEFAULT_LOCATORS, isUsable } from '../shell/page.dom';
import { buildTarget, isEditableTarget, looksGenerated, roleOf } from '../shell/selector.dom';

export type { Candidate } from '../core/repair';

/** Roles a step acts on. Elements without a role (a label, a focusable div) count when they have a name. */
const ACT_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'slider', 'spinbutton', 'treeitem', 'gridcell', 'row', 'listitem']);
const ACTIONABLE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, label, [role], [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"]), [onclick]';
/**
 * Never offered: the overlay, ignored and blurred areas. Masked areas are offered (a step types into a masked
 * field), but no field's value is ever read.
 */
export const SKIP = '[data-trace-ignore], [data-trace-avatar], [data-trace-blur]';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

let last: Element[] = [];

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
