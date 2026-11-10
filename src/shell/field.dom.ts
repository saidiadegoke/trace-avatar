/**
 * Facts about a form field, read from the DOM: for the mask rule (recording) and for security (perform mode).
 */

import type { FieldFacts } from '../core/mask';

/** What the field says it is: aria-label, placeholder, and its label's text. */
function hintOf(el: Element): string {
  const parts = [el.getAttribute('aria-label'), el.getAttribute('placeholder')];
  const labels = (el as HTMLInputElement).labels;
  if (labels) for (const l of Array.from(labels)) parts.push(l.textContent);
  const by = el.getAttribute('aria-labelledby');
  if (by) for (const id of by.split(/\s+/)) parts.push(el.ownerDocument?.getElementById(id)?.textContent ?? null);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Facts about a field for the mask and security rules. */
export function factsOf(el: Element): FieldFacts {
  return {
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    autocomplete: el.getAttribute('autocomplete') || '',
    name: el.getAttribute('name') || '',
    id: el.id || '',
    marked: !!el.closest('[data-trace-mask]'),
    revealed: !!el.closest('[data-trace-reveal]'),
    inputmode: el.getAttribute('inputmode') || undefined,
    hint: hintOf(el) || undefined,
  };
}

/** Where Enter adds a line instead of finishing the field. */
export function isMultiline(el: Element): boolean {
  return el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('aria-multiline') === 'true';
}

/**
 * The file input a step means: the element itself, one inside it, the one its label is for, or the nearest one
 * around it (an "Attach files" button next to a hidden input).
 */
export function fileInputOf(el: Element | null): HTMLInputElement | null {
  if (!el) return null;
  const isFile = (e: Element | null | undefined): e is HTMLInputElement => !!e && e.tagName === 'INPUT' && (e as HTMLInputElement).type === 'file';
  if (isFile(el)) return el;
  const inside = el.querySelector?.('input[type=file]');
  if (isFile(inside)) return inside;
  const label = el.closest?.('label') as HTMLLabelElement | null;
  if (label && isFile(label.control)) return label.control as HTMLInputElement;
  let up: Element | null = el.parentElement;
  for (let k = 0; up && k < 4; k += 1, up = up.parentElement) {
    const near = up.querySelectorAll('input[type=file]');
    if (near.length === 1 && isFile(near[0])) return near[0] as HTMLInputElement;
  }
  return null;
}
