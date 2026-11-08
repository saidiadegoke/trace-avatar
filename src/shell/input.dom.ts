/**
 * Real viewer input during playback. Only trusted events from outside the
 * overlay count: our own controls and any synthetic events are ignored.
 */

import type { InputPort } from './ports';

export function createInput(doc: Document, host: () => Element | null): InputPort {
  return {
    watch(cb) {
      const handler = (e: Event) => {
        if (!e.isTrusted) return;
        const h = host();
        if (h && e.composedPath().includes(h)) return;
        cb(e as PointerEvent | KeyboardEvent);
      };
      doc.addEventListener('pointerdown', handler, true);
      doc.addEventListener('keydown', handler, true);
      return () => {
        doc.removeEventListener('pointerdown', handler, true);
        doc.removeEventListener('keydown', handler, true);
      };
    },
  };
}

/** Typing into a field must never be read as a shortcut. */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
  }
  return false;
}
