/**
 * Perform mode's hands: act out a step on the real page.
 *
 * Every event here is synthetic (`isTrusted: false`). Most apps respond to them; a few
 * security-sensitive things never will (file pickers, fullscreen, clipboard, payment iframes),
 * and the input port ignores them, so the guide never mistakes its own actions for a takeover.
 *
 * Values are set through the native setter, then `input` is dispatched: that is what makes
 * React, Vue and Svelte controlled inputs see the change. Rich-text editors get `insertText`
 * (best effort, with a plain fallback).
 */

export interface Performer {
  click(el: Element, x?: number, y?: number, double?: boolean): void;
  hover(el: Element, x?: number, y?: number): void;
  /** Press a combo ("Mod+Enter") on el, or on the focused element. */
  key(el: Element | null, combo: string): void;
  /** Focus a field and empty it, ready for typing. Returns the field typed into. */
  startTyping(el: Element): Element;
  /** Type text[from, to) into the field (it already holds text[0, from)). */
  typeTo(field: Element, text: string, from: number, to: number): void;
  /** Typing is done: fire `change` as a person leaving the field would. */
  finishTyping(field: Element): void;
  focus(el: Element): void;
}

const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The field a type step means: the element itself, or the one input inside a wrapper or label. Exported for tests. */
export function fieldOf(el: Element): Element {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || isRich(el)) return el;
  return el.querySelector('input, textarea, select, [contenteditable]:not([contenteditable="false"])') ?? el;
}

function isRich(el: Element): boolean {
  return (el as HTMLElement).isContentEditable || (el.getAttribute('contenteditable') ?? 'false') !== 'false';
}

/** Set `value` through the prototype's setter, so framework value trackers notice. Exported for tests. */
export function setNativeValue(el: Element, value: string): void {
  let proto: object | null = Object.getPrototypeOf(el);
  let desc: PropertyDescriptor | undefined;
  while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, 'value'))) proto = Object.getPrototypeOf(proto);
  if (desc?.set) desc.set.call(el, value);
  else (el as HTMLInputElement).value = value;
}

const MAC = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab', space: ' ', backspace: 'Backspace',
  delete: 'Delete', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', home: 'Home', end: 'End',
};

/** "Mod+Shift+K" → key and modifier flags. Mod is ⌘ on a Mac, Ctrl elsewhere. Exported for tests. */
export function parseCombo(combo: string, mac = MAC()): { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean } {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  const last = parts.pop() ?? '';
  const flags = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  for (const m of parts.map((p) => p.toLowerCase())) {
    if (m === 'mod') { if (mac) flags.metaKey = true; else flags.ctrlKey = true; }
    else if (m === 'cmd' || m === 'meta') flags.metaKey = true;
    else if (m === 'ctrl' || m === 'control') flags.ctrlKey = true;
    else if (m === 'alt' || m === 'option') flags.altKey = true;
    else if (m === 'shift') flags.shiftKey = true;
  }
  const key = KEY_ALIASES[last.toLowerCase()] ?? (last.length === 1 ? (flags.shiftKey ? last.toUpperCase() : last.toLowerCase()) : last);
  return { key, ...flags };
}

export function createPerformer(doc: Document): Performer {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const Pointer = (view?.PointerEvent ?? view?.MouseEvent ?? MouseEvent) as typeof MouseEvent;
  const Mouse = (view?.MouseEvent ?? MouseEvent) as typeof MouseEvent;
  const Input = (view?.InputEvent ?? view?.Event ?? Event) as typeof InputEvent;
  const Key = (view?.KeyboardEvent ?? KeyboardEvent) as typeof KeyboardEvent;
  const Plain = (view?.Event ?? Event) as typeof Event;

  /** The innermost element under (x, y) inside el (what a real click would hit), else el. */
  const hitIn = (el: Element, x?: number, y?: number): Element => {
    if (x === undefined || y === undefined || typeof doc.elementFromPoint !== 'function') return el;
    const hit = doc.elementFromPoint(x, y);
    return hit && el.contains(hit) ? hit : el;
  };
  const mouse = (target: Element, type: string, x?: number, y?: number, extra: MouseEventInit = {}) => {
    const C = type.startsWith('pointer') ? Pointer : Mouse;
    const bubbles = !type.endsWith('enter') && !type.endsWith('leave');
    return target.dispatchEvent(new C(type, { bubbles, cancelable: bubbles, composed: true, view, clientX: x ?? 0, clientY: y ?? 0, button: 0, ...extra }));
  };
  const focusable = (el: Element): el is HTMLElement => typeof (el as HTMLElement).focus === 'function';
  const focus = (el: Element) => {
    const f = el.closest('input, textarea, select, button, a[href], [tabindex], [contenteditable]:not([contenteditable="false"])') ?? el;
    if (focusable(f)) f.focus({ preventScroll: true });
  };

  const press = (el: Element, x?: number, y?: number, detail = 1) => {
    const t = hitIn(el, x, y);
    mouse(t, 'pointerdown', x, y, { buttons: 1, detail });
    const down = mouse(t, 'mousedown', x, y, { buttons: 1, detail });
    if (down) focus(t);
    mouse(t, 'pointerup', x, y, { detail });
    mouse(t, 'mouseup', x, y, { detail });
    mouse(t, 'click', x, y, { detail });
  };

  const fire = (el: Element, type: string, init: EventInit = {}) => el.dispatchEvent(new Plain(type, { bubbles: true, ...init }));
  const inputEvent = (el: Element, data: string | null, inputType: string) =>
    el.dispatchEvent(new Input('input', { bubbles: true, composed: true, data, inputType } as InputEventInit));

  /**
   * The caret at the end of the field's text: inside its last text node (or its last line, when empty), not
   * after the field's last child. Firefox leaves a caret there, outside every paragraph, and an editor like
   * Lexical ignores what is typed at it (only the first letter got in).
   */
  const caretToEnd = (field: Element) => {
    const sel = doc.getSelection?.();
    if (!sel) return;
    const range = doc.createRange();
    let last: Node | null = null;
    const walk = doc.createTreeWalker(field, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) last = n;
    if (last) range.setStart(last, (last as Text).length);
    else {
      let el: Element = field;
      while (el.lastElementChild && el.lastElementChild.tagName !== 'BR') el = el.lastElementChild;
      range.selectNodeContents(el);
    }
    range.collapse(!!last);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const exec = (cmd: string, value?: string): boolean => {
    try { return typeof doc.execCommand === 'function' && doc.execCommand(cmd, false, value); } catch { return false; }
  };

  return {
    click(el, x, y, double = false) {
      press(el, x, y, 1);
      if (double) {
        press(el, x, y, 2);
        mouse(hitIn(el, x, y), 'dblclick', x, y, { detail: 2 });
      }
    },
    hover(el, x, y) {
      const t = hitIn(el, x, y);
      for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) mouse(t, type, x, y);
    },
    key(el, combo) {
      const target = el ?? doc.activeElement ?? doc.body;
      const k = parseCombo(combo);
      const init = { ...k, bubbles: true, cancelable: true, composed: true, view };
      const go = target.dispatchEvent(new Key('keydown', init));
      // A real Enter in a form field submits the form; a synthetic one doesn't, so do it.
      const plain = !k.ctrlKey && !k.metaKey && !k.altKey && !k.shiftKey;
      if (go && plain && k.key === 'Enter' && target.tagName === 'INPUT') {
        const form = (target as HTMLInputElement).form;
        if (form) { if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit(); }
      }
      target.dispatchEvent(new Key('keyup', init));
    },
    startTyping(el) {
      const field = fieldOf(el);
      focus(field);
      if (field.tagName === 'SELECT') return field;
      if (isRich(field)) {
        if (field.textContent) {
          const sel = doc.getSelection?.();
          const range = doc.createRange();
          range.selectNodeContents(field);
          sel?.removeAllRanges();
          sel?.addRange(range);
          if (!exec('delete')) { field.textContent = ''; inputEvent(field, null, 'deleteContentBackward'); }
        }
        return field;
      }
      if ((field as HTMLInputElement).value) {
        setNativeValue(field, '');
        inputEvent(field, null, 'deleteContentBackward');
      }
      return field;
    },
    typeTo(field, text, from, to) {
      if (to <= from) return;
      if (field.tagName === 'SELECT') {
        if (to < text.length) return; // a select changes once, to its whole option
        const sel = field as HTMLSelectElement;
        const want = norm(text);
        const opt = Array.from(sel.options).find((o) => norm(o.textContent) === want) ?? Array.from(sel.options).find((o) => norm(o.value) === want);
        if (opt) { setNativeValue(sel, opt.value); inputEvent(sel, null, 'insertReplacementText'); }
        return;
      }
      const chunk = text.slice(from, to);
      if (isRich(field)) {
        caretToEnd(field);
        if (!exec('insertText', chunk)) {
          const before = new Input('beforeinput', { bubbles: true, cancelable: true, composed: true, data: chunk, inputType: 'insertText' } as InputEventInit);
          if (field.dispatchEvent(before)) {
            field.appendChild(doc.createTextNode(chunk));
            inputEvent(field, chunk, 'insertText');
          }
        }
        return;
      }
      setNativeValue(field, text.slice(0, to));
      inputEvent(field, chunk, 'insertText');
    },
    finishTyping(field) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName)) fire(field, 'change');
    },
    focus,
  };
}
