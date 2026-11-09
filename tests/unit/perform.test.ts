// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPerformer, fieldOf, parseCombo, setNativeValue } from '../../src/shell/perform.dom';
import { html } from './dom-helpers';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as unknown as T;

/** Record events of the given types fired on (or bubbling through) the body. */
function listen(types: string[]) {
  const log: Array<[string, string, Record<string, unknown>]> = [];
  for (const type of types) {
    document.addEventListener(type, (e) => {
      const ev = e as MouseEvent & KeyboardEvent & InputEvent;
      log.push([type, (e.target as Element).id || (e.target as Element).tagName, { detail: ev.detail, x: ev.clientX, key: ev.key, data: ev.data, ctrl: ev.ctrlKey, meta: ev.metaKey, shift: ev.shiftKey, trusted: e.isTrusted }]);
    }, true);
  }
  return log;
}

describe('parseCombo', () => {
  it('Mod is ⌘ on a Mac and Ctrl elsewhere; aliases; letters follow Shift', () => {
    expect(parseCombo('Mod+Enter', true)).toEqual({ key: 'Enter', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false });
    expect(parseCombo('Mod+Enter', false)).toMatchObject({ key: 'Enter', metaKey: false, ctrlKey: true });
    expect(parseCombo('Ctrl+Alt+Shift+k', true)).toEqual({ key: 'K', metaKey: false, ctrlKey: true, altKey: true, shiftKey: true });
    expect(parseCombo('Cmd+Option+Control+Meta+p', false)).toMatchObject({ key: 'p', metaKey: true, ctrlKey: true, altKey: true });
    expect(parseCombo('esc').key).toBe('Escape');
    expect(parseCombo('Space').key).toBe(' ');
    expect(parseCombo('K').key).toBe('k');
    expect(parseCombo('F5').key).toBe('F5');
    expect(parseCombo('').key).toBe('');
  });
});

describe('fieldOf / setNativeValue', () => {
  it('finds the field inside a wrapper or label, or the element itself', () => {
    html('<label id="l">Name <input id="i"></label><div id="w"><textarea id="t"></textarea></div><div id="rich" contenteditable="true"></div><button id="b">x</button>');
    expect(fieldOf($('#l')).id).toBe('i');
    expect(fieldOf($('#w')).id).toBe('t');
    expect(fieldOf($('#rich')).id).toBe('rich');
    expect(fieldOf($('#i')).id).toBe('i');
    expect(fieldOf($('#b')).id).toBe('b');
  });

  it('sets the value through the prototype setter, past an instance override (what React installs)', () => {
    html('<input id="i">');
    const el = $<HTMLInputElement>('#i');
    const seen: string[] = [];
    // Like React's value tracker: an own property that records writes made through it.
    const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!;
    Object.defineProperty(el, 'value', { configurable: true, get() { return proto.get!.call(this); }, set(v) { seen.push(v); proto.set!.call(this, v); } });
    setNativeValue(el, 'Ada');
    expect(el.value).toBe('Ada');
    expect(seen).toEqual([]); // went round the tracker, so the framework sees a change on 'input'
    const plain = { value: '' } as unknown as Element;
    setNativeValue(plain, 'x');
    expect((plain as unknown as { value: string }).value).toBe('x');
  });
});

describe('createPerformer', () => {
  it('click: pointer and mouse events in order, at the point, focusing the control', () => {
    html('<button id="b"><span id="in">Save</span></button>');
    const log = listen(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']);
    (document as Document & { elementFromPoint: unknown }).elementFromPoint = () => $('#in');
    createPerformer(document).click($('#b'), 30, 20);
    expect(log.map(([t, id]) => `${t}@${id}`)).toEqual(['pointerdown@in', 'mousedown@in', 'pointerup@in', 'mouseup@in', 'click@in']);
    expect(log[0][2]).toMatchObject({ x: 30, detail: 1 });
    expect(document.activeElement?.id).toBe('b');
  });

  it('click hits the element itself when the point is outside it, or unknown; dblclick adds a second press and dblclick', () => {
    html('<button id="b">B</button><div id="other"></div>');
    (document as Document & { elementFromPoint: unknown }).elementFromPoint = () => $('#other');
    const log = listen(['click', 'dblclick']);
    const hands = createPerformer(document);
    hands.click($('#b'), 1, 1, true);
    expect(log.map(([t, id, d]) => `${t}@${id}:${d.detail}`)).toEqual(['click@b:1', 'click@b:2', 'dblclick@b:2']);
    log.length = 0;
    hands.click($('#b'));
    expect(log.map(([t, id]) => `${t}@${id}`)).toEqual(['click@b']);
  });

  it('a prevented mousedown does not move focus', () => {
    html('<button id="b">B</button><input id="keep">');
    $<HTMLInputElement>('#keep').focus();
    $('#b').addEventListener('mousedown', (e) => e.preventDefault());
    createPerformer(document).click($('#b'));
    expect(document.activeElement?.id).toBe('keep');
  });

  it('hover: over, enter, move', () => {
    html('<div id="m">menu</div>');
    const log = listen(['pointerover', 'mouseover', 'pointermove', 'mousemove']);
    let entered = 0;
    $('#m').addEventListener('mouseenter', () => { entered += 1; });
    createPerformer(document).hover($('#m'), 5, 5);
    expect(log.map(([t]) => t)).toEqual(['pointerover', 'mouseover', 'pointermove', 'mousemove']);
    expect(entered).toBe(1);
  });

  it('key: keydown and keyup with modifiers, on the element or the focused one', () => {
    html('<input id="i"><div id="d" tabindex="0"></div>');
    const log = listen(['keydown', 'keyup']);
    const hands = createPerformer(document);
    hands.key($('#d'), 'Shift+k');
    $<HTMLInputElement>('#i').focus();
    hands.key(null, 'Escape');
    expect(log.map(([t, id, d]) => `${t}@${id}:${d.key}:${d.shift}`)).toEqual(['keydown@d:K:true', 'keyup@d:K:true', 'keydown@i:Escape:false', 'keyup@i:Escape:false']);
  });

  it('Enter in a form field submits the form, unless prevented, modified, or in a textarea', () => {
    html('<form id="f"><input id="i"><textarea id="t"></textarea></form>');
    const form = $<HTMLFormElement>('#f');
    const submit = vi.fn();
    form.requestSubmit = submit;
    const hands = createPerformer(document);
    hands.key($('#i'), 'Enter');
    expect(submit).toHaveBeenCalledTimes(1);
    hands.key($('#i'), 'Shift+Enter');
    hands.key($('#t'), 'Enter');
    $('#i').addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    hands.key($('#i'), 'Enter');
    expect(submit).toHaveBeenCalledTimes(1);
    (form as { requestSubmit?: unknown }).requestSubmit = undefined;
    form.submit = vi.fn();
    hands.key($('#i'), 'Enter');
    expect(form.submit).toHaveBeenCalledTimes(1);
    html('<input id="lone">');
    expect(() => hands.key($('#lone'), 'Enter')).not.toThrow();
  });

  it('types into an input: clears it, then one input event per chunk with the data; change at the end', () => {
    html('<input id="i" value="old">');
    const el = $<HTMLInputElement>('#i');
    const log = listen(['input', 'change']);
    const hands = createPerformer(document);
    const field = hands.startTyping(el);
    expect([field, el.value, document.activeElement]).toEqual([el, '', el]);
    hands.typeTo(field, 'Ada', 0, 1);
    hands.typeTo(field, 'Ada', 1, 3);
    hands.typeTo(field, 'Ada', 3, 3); // nothing new
    hands.finishTyping(field);
    expect(el.value).toBe('Ada');
    expect(log.map(([t, , d]) => `${t}:${d.data ?? ''}`)).toEqual(['input:', 'input:A', 'input:da', 'change:']);
  });

  it('an empty field is not cleared again; a wrapper types into its field', () => {
    html('<label id="l">Name <textarea id="t"></textarea></label>');
    const log = listen(['input']);
    const hands = createPerformer(document);
    const field = hands.startTyping($('#l'));
    expect(field.id).toBe('t');
    expect(log).toEqual([]);
  });

  it('rich text: insertText when the browser has it; otherwise beforeinput + a text node + input', () => {
    html('<div id="r" contenteditable="true">old</div>');
    const el = $('#r');
    const hands = createPerformer(document);
    const exec = vi.fn((cmd: string, _ui?: boolean, value?: string) => {
      if (cmd === 'delete') { el.textContent = ''; return true; }
      if (cmd === 'insertText') { el.append(value!); return true; }
      return false;
    });
    (document as Document & { execCommand: unknown }).execCommand = exec;
    const field = hands.startTyping(el);
    hands.typeTo(field, 'Hello', 0, 5);
    expect(el.textContent).toBe('Hello');
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['delete', 'insertText']);

    (document as Document & { execCommand: unknown }).execCommand = () => { throw new Error('unsupported'); };
    el.textContent = 'old';
    const log = listen(['beforeinput', 'input']);
    hands.startTyping(el);
    expect(el.textContent).toBe('');
    hands.typeTo(el, 'Hi', 0, 2);
    expect(el.textContent).toBe('Hi');
    expect(log.map(([t, , d]) => `${t}:${d.data ?? ''}`)).toEqual(['input:', 'beforeinput:Hi', 'input:Hi']);

    // An editor that handles beforeinput itself (prevents it) gets nothing extra.
    el.addEventListener('beforeinput', (e) => e.preventDefault());
    hands.typeTo(el, 'Hi!', 2, 3);
    expect(el.textContent).toBe('Hi');
    hands.finishTyping(el); // no change event for rich text
  });

  it('a select picks the option by its text (or value), once, when typing reaches the end', () => {
    html('<select id="s"><option value="1">One</option><option value="2">Two</option></select>');
    const sel = $<HTMLSelectElement>('#s');
    const log = listen(['input', 'change']);
    const hands = createPerformer(document);
    expect(hands.startTyping(sel)).toBe(sel);
    hands.typeTo(sel, 'Two', 0, 2);
    expect(sel.value).toBe('1');
    hands.typeTo(sel, 'two', 2, 3);
    expect(sel.value).toBe('2');
    hands.typeTo(sel, '1', 0, 1);
    expect(sel.value).toBe('1');
    hands.typeTo(sel, 'Three', 0, 5); // no such option: unchanged
    expect(sel.value).toBe('1');
    hands.finishTyping(sel);
    expect(log.map(([t]) => t)).toEqual(['input', 'input', 'change']);
  });

  it('focus climbs to the focusable control', () => {
    html('<a href="#x" id="a"><span id="s">go</span></a>');
    createPerformer(document).focus($('#s'));
    expect(document.activeElement?.id).toBe('a');
  });
});
