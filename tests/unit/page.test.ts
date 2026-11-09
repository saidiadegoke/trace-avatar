// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../../src/core/format';
import type { NStep, Target } from '../../src/core/format';
import { DEFAULT_LOCATORS, accessibleName, byRoleAndName, bySelector, byText, createPage, isUsable } from '../../src/shell/page.dom';
import { createEmitter } from '../../src/shell/emitter';
import { createInput, isEditable } from '../../src/shell/input.dom';
import { browserClock } from '../../src/shell/ports';
import { html, setRect } from './dom-helpers';

const step = {} as NStep;
const find = (loc: typeof bySelector, t: Target) => loc(t, document, step);

beforeEach(() => { document.body.innerHTML = ''; });

describe('isUsable', () => {
  it('needs a connected element with a box that is not hidden', () => {
    html('<button id="a">A</button><button id="b" style="visibility:hidden">B</button>');
    const a = document.getElementById('a')!;
    expect(isUsable(a)).toBe(true);
    expect(isUsable(document.getElementById('b')!)).toBe(false);
    setRect(a, 0, 0, 0, 0);
    expect(isUsable(a)).toBe(false);
    const loose = document.createElement('div');
    setRect(loose, 0, 0);
    expect(isUsable(loose)).toBe(false);
  });

  it('uses checkVisibility when the browser has it', () => {
    html('<button id="a">A</button>');
    const a = document.getElementById('a')! as HTMLElement & { checkVisibility?: () => boolean };
    a.checkVisibility = vi.fn(() => false);
    expect(isUsable(a)).toBe(false);
    expect(a.checkVisibility).toHaveBeenCalled();
  });

  it('accepts a rect passed in instead of measuring', () => {
    html('<button id="a">A</button>');
    const a = document.getElementById('a')!;
    expect(isUsable(a, { width: 0, height: 0 } as DOMRect)).toBe(false);
  });
});

describe('accessibleName', () => {
  it('reads aria-label, labelledby, labels, alt, button values, placeholder, text and title', () => {
    html(`
      <button id="a" aria-label="Close">×</button>
      <span id="lab">Customer name</span><input id="b" aria-labelledby="lab">
      <label for="c">Email</label><input id="c">
      <img id="d" alt="Logo">
      <input id="e" type="submit" value="Send">
      <input id="f" placeholder="Search…">
      <a id="g" href="#">  New   invoice </a>
      <div id="h" title="Tip"></div>
    `);
    const n = (id: string) => accessibleName(document.getElementById(id)!).replace(/\s+/g, ' ').trim();
    expect(n('a')).toBe('Close');
    expect(n('b')).toBe('Customer name');
    expect(n('c')).toBe('Email');
    expect(n('d')).toBe('Logo');
    expect(n('e')).toBe('Send');
    expect(n('f')).toBe('Search…');
    expect(n('g')).toBe('New invoice');
    expect(n('h')).toBe('Tip');
  });
});

describe('bySelector', () => {
  it('returns the first usable match', () => {
    html('<i class="x" id="one"></i><i class="x" id="two"></i>');
    setRect(document.getElementById('one')!, 0, 0, 0, 0);
    expect(find(bySelector, { sel: '.x' })?.id).toBe('two');
  });
  it('returns null for no selector, no match or an invalid selector', () => {
    html('<i id="a"></i>');
    expect(find(bySelector, { text: 'x' })).toBeNull();
    expect(find(bySelector, { sel: '#zzz' })).toBeNull();
    expect(find(bySelector, { sel: '###' })).toBeNull();
  });
});

describe('byRoleAndName', () => {
  beforeEach(() => html(`
    <button id="save">Save</button>
    <button id="saveas">Save as…</button>
    <div role="button" id="custom" aria-label="Archive"></div>
    <input type="submit" id="submit" value="Submit form">
    <a href="/x" id="link">Pricing</a>
    <label for="em">Email</label><input id="em" type="email">
    <textarea id="notes" placeholder="Notes"></textarea>
    <h2 id="h">Billing</h2>
    <div role="tab" id="tab">Overview</div>
  `));

  it('matches the exact name first, then a name that contains it', () => {
    expect(find(byRoleAndName, { role: 'button', name: 'save' })?.id).toBe('save');
    expect(find(byRoleAndName, { role: 'button', name: 'Save as' })?.id).toBe('saveas');
    expect(find(byRoleAndName, { role: 'button', name: 'submit' })?.id).toBe('submit');
  });
  it('knows implicit roles and explicit role attributes', () => {
    expect(find(byRoleAndName, { role: 'button', name: 'Archive' })?.id).toBe('custom');
    expect(find(byRoleAndName, { role: 'link', name: 'Pricing' })?.id).toBe('link');
    expect(find(byRoleAndName, { role: 'textbox', name: 'Email' })?.id).toBe('em');
    expect(find(byRoleAndName, { role: 'textbox', name: 'Notes' })?.id).toBe('notes');
    expect(find(byRoleAndName, { role: 'heading', name: 'Billing' })?.id).toBe('h');
    expect(find(byRoleAndName, { role: 'tab', name: 'overview' })?.id).toBe('tab');
  });
  it('roles without a built-in mapping match the role attribute (escaped)', () => {
    html('<div role="gridcell" id="cell">Total</div>');
    expect(find(byRoleAndName, { role: 'gridcell', name: 'Total' })?.id).toBe('cell');
    expect(find(byRoleAndName, { role: 'x"]' })).toBeNull();
  });

  it('without a name takes the first usable one; unknown names give null', () => {
    expect(find(byRoleAndName, { role: 'link' })?.id).toBe('link');
    expect(find(byRoleAndName, { role: 'button', name: 'Delete' })).toBeNull();
    expect(find(byRoleAndName, { sel: '#save' })).toBeNull();
    expect(find(byRoleAndName, { role: 'listitem' })).toBeNull();
  });
});

describe('byText', () => {
  it('finds the smallest element whose whole text matches, ignoring case and spacing', () => {
    html('<section><div><p id="p">New  <b>invoice</b></p></div></section>');
    expect(find(byText, { text: 'new invoice' })?.id).toBe('p');
  });
  it('falls back to an element that contains the text', () => {
    html('<p id="p">Click New invoice to begin</p>');
    expect(find(byText, { text: 'New invoice' })?.id).toBe('p');
  });
  it('skips hidden matches and the overlay itself, and returns null otherwise', () => {
    html('<div data-trace-avatar><span>Pay now</span></div><p id="hid">Pay now</p><p id="ok">Pay now</p>');
    setRect(document.getElementById('hid')!, 0, 0, 0, 0);
    expect(find(byText, { text: 'Pay now' })?.id).toBe('ok');
    expect(find(byText, { text: 'Nothing like this' })).toBeNull();
    expect(find(byText, { text: '   ' })).toBeNull();
    expect(find(byText, { sel: '#ok' })).toBeNull();
  });
});

describe('createPage', () => {
  const trace = (steps: object[], meta: object = {}) => {
    const r = parse({ version: 1, meta, steps });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.trace;
  };
  const vp = { w: 1000, h: 800 };

  it('looks up boxes in viewport pixels, tells which locator found them, and whether they are in view', () => {
    html('<button id="a">Save</button><button id="b">Far</button>');
    setRect(document.getElementById('a')!, 10, 20, 80, 30);
    setRect(document.getElementById('b')!, 10, 3000, 80, 30);
    const tr = trace([{ type: 'click', target: { role: 'button', name: 'Save' } }, { type: 'click', target: { sel: '#b' } }]);
    const page = createPage();
    const look = page.looker(tr, vp);
    expect(look(0)).toEqual({ x: 10, y: 20, w: 80, h: 30, by: 'role', inView: true });
    expect(look(1)).toMatchObject({ by: 'sel', inView: false });
    expect(page.element(0)?.id).toBe('a');
  });

  it('memoises within a frame and re-resolves across frames when the node is replaced', () => {
    html('<button id="a">Save</button>');
    const tr = trace([{ type: 'click', target: { sel: '#a' } }]);
    let calls = 0;
    const counting = (t: Target, root: ParentNode) => { calls += 1; return bySelector(t, root, step); };
    const page = createPage({ locators: [counting] });
    const look = page.looker(tr, vp);
    look(0); look(0);
    expect(calls).toBe(1);
    page.looker(tr, vp)(0);
    expect(calls).toBe(1); // the cached element is still usable
    const fresh = document.createElement('button');
    fresh.id = 'a';
    document.getElementById('a')!.replaceWith(fresh);
    setRect(fresh, 300, 300);
    expect(page.looker(tr, vp)(0)).toMatchObject({ x: 300, y: 300 });
    expect(calls).toBe(2);
    expect(page.element(0)).toBe(fresh);
  });

  it('falls back to recorded pixels, scaled to this viewport', () => {
    html('');
    const tr = trace([{ type: 'click', target: { sel: '#gone', xy: { x: 500, y: 400 } } }], { viewport: { w: 2000, h: 1600 } });
    expect(createPage().looker(tr, vp)(0)).toEqual({ x: 250, y: 200, w: 0, h: 0, by: 'xy', inView: true });
    const unscaled = trace([{ type: 'click', target: { xy: { x: 5, y: 6 } } }]);
    expect(createPage().looker(unscaled, vp)(0)).toMatchObject({ x: 5, y: 6 });
  });

  it('returns null for a missing element or a step without a target', () => {
    html('');
    const tr = trace([{ type: 'click', target: { sel: '#gone' } }, { type: 'note', say: 'x' }]);
    const look = createPage().looker(tr, vp);
    expect(look(0)).toBeNull();
    expect(look(1)).toBeNull();
    expect(look(9)).toBeNull();
  });

  it('tries host locators before the built-in ones, and searches only under root', () => {
    html('<div id="r"><button id="in">Go</button></div><button id="out">Go</button>');
    const tr = trace([{ type: 'click', target: { text: 'Go' } }]);
    expect(createPage({ root: document.getElementById('r')! }).looker(tr, vp)(0)).toMatchObject({ by: 'text' });
    const page = createPage({ root: document.getElementById('r')! });
    page.looker(tr, vp)(0);
    expect(page.element(0)?.id).toBe('in');
    const custom = vi.fn(() => document.getElementById('out'));
    const page2 = createPage({ locators: [custom] });
    page2.looker(tr, vp)(0);
    expect(custom).toHaveBeenCalled();
    expect(page2.element(0)?.id).toBe('out');
  });

  it('clear forgets cached elements; viewport reads the window', () => {
    html('<button id="a">Save</button>');
    const tr = trace([{ type: 'click', target: { sel: '#a' } }]);
    const page = createPage();
    page.looker(tr, vp)(0);
    page.clear();
    expect(page.element(0)).toBeNull();
    expect(page.viewport()).toEqual({ w: window.innerWidth, h: window.innerHeight });
  });

  it('exports the default chain in order', () => {
    expect(DEFAULT_LOCATORS).toEqual([bySelector, byRoleAndName, byText]);
  });
});

describe('emitter', () => {
  it('adds, removes, ignores duplicates and clears', () => {
    const e = createEmitter<{ a: number }>();
    const fn = vi.fn();
    const off = e.on('a', fn);
    e.on('a', fn);
    expect(e.count('a')).toBe(1);
    e.emit('a', 5);
    expect(fn).toHaveBeenCalledWith(5);
    off();
    e.emit('a', 6);
    expect(fn).toHaveBeenCalledTimes(1);
    e.on('a', fn);
    e.clear();
    expect(e.count('a')).toBe(0);
    e.emit('a', 1);
  });

  it('reports a throwing listener and still calls the others', () => {
    const onError = vi.fn();
    const e = createEmitter<{ a: void }>(onError);
    const good = vi.fn();
    e.on('a', () => { throw new Error('boom'); });
    e.on('a', good);
    e.emit('a', undefined);
    expect(onError).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it('logs to the console by default', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = createEmitter<{ a: void }>();
    e.on('a', () => { throw new Error('x'); });
    e.emit('a', undefined);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('input', () => {
  it('isEditable knows fields from buttons', () => {
    html('<input id="t"><input id="b" type="button"><input id="c" type="checkbox"><textarea id="ta"></textarea><select id="s"></select><div id="ce" contenteditable="true"></div><div id="d"></div>');
    const e = (id: string) => isEditable(document.getElementById(id));
    expect([e('t'), e('ta'), e('s')]).toEqual([true, true, true]);
    expect([e('b'), e('c'), e('d')]).toEqual([false, false, false]);
    const ce = document.getElementById('ce')! as HTMLElement;
    Object.defineProperty(ce, 'isContentEditable', { value: true });
    expect(isEditable(ce)).toBe(true);
    expect(isEditable(null)).toBe(false);
    expect(isEditable(window as unknown as EventTarget)).toBe(false);
  });

  it('ignores synthetic events and events from the overlay, and unsubscribes', () => {
    html('<button id="a">A</button><div id="host"></div>');
    const host = document.getElementById('host')!;
    const cb = vi.fn();
    const off = createInput(document, () => host).watch(cb);
    document.getElementById('a')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cb).not.toHaveBeenCalled(); // synthetic: isTrusted is false
    // Simulate trusted events by faking isTrusted.
    const trusted = (type: string, target: Element) => {
      const ev = new Event(type, { bubbles: true, composed: true });
      Object.defineProperty(ev, 'isTrusted', { value: true });
      target.dispatchEvent(ev);
    };
    trusted('pointerdown', document.getElementById('a')!);
    trusted('keydown', document.getElementById('a')!);
    expect(cb).toHaveBeenCalledTimes(2);
    trusted('pointerdown', host);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    trusted('pointerdown', document.getElementById('a')!);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('browserClock', () => {
  it('reads performance.now and schedules and cancels animation frames', async () => {
    expect(browserClock.now()).toBeCloseTo(performance.now(), -2);
    const fired = vi.fn();
    const id = browserClock.raf(fired);
    browserClock.caf(id);
    const fired2 = vi.fn();
    browserClock.raf(fired2);
    await new Promise((r) => setTimeout(r, 50));
    expect(fired).not.toHaveBeenCalled();
    expect(fired2).toHaveBeenCalled();
  });
});

describe('until (0.1.2)', () => {
  const tr = () => {
    const r = parse({ version: 1, steps: [
      { type: 'wait', target: { sel: '#status' }, until: { text: 'Running' } },
      { type: 'wait', until: { text: 'Task started' } },
      { type: 'wait', target: { sel: '.spin' }, until: { gone: true } },
      { type: 'note', say: 'x' },
    ] });
    if (!r.ok) throw new Error('bad');
    return r.trace;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0)); // let the MutationObserver report

  it('text in the target, text anywhere (visible only), gone; steps without until are always met', async () => {
    html('<span id="status">Queued</span><div class="spin">…</div><p id="off">Task started</p>');
    setRect(document.getElementById('off')!, 0, 0, 0, 0); // not visible: doesn't count
    const page = createPage();
    const t = tr();
    let met = page.until!(t, 0);
    expect([met(0), met(1), met(2), met(3), met(99)]).toEqual([false, false, false, true, true]);
    document.getElementById('status')!.textContent = 'Running now';
    const toast = document.createElement('p');
    toast.textContent = 'Task  STARTED';
    document.body.appendChild(toast);
    setRect(toast, 0, 0);
    document.querySelector('.spin')!.remove();
    await flush();
    met = page.until!(t, 300);
    expect([met(0), met(1), met(2)]).toEqual([true, true, true]);
  });

  it('is checked at most every 250 ms, and only again once the page changed', async () => {
    html('<span id="status">Queued</span>');
    const page = createPage();
    const t = tr();
    expect(page.until!(t, 0)(0)).toBe(false);
    document.getElementById('status')!.textContent = 'Running';
    await flush();
    expect(page.until!(t, 100)(0)).toBe(false); // too soon: the remembered answer
    expect(page.until!(t, 260)(0)).toBe(true);
    // Unchanged page: no recheck, even much later (the answer can't have changed).
    const spy = vi.spyOn(document, 'querySelectorAll');
    page.until!(t, 5000)(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('without MutationObserver it rechecks every 250 ms; clear() forgets and stops watching', async () => {
    html('<span id="status">Queued</span>');
    const win = Object.create(window, { MutationObserver: { value: undefined } }) as Window;
    Object.defineProperty(win, 'document', { value: document });
    const page = createPage({ win, root: document });
    const t = tr();
    expect(page.until!(t, 0)(0)).toBe(false);
    document.getElementById('status')!.textContent = 'Running';
    expect(page.until!(t, 300)(0)).toBe(true);

    const watched = createPage();
    expect(watched.until!(t, 0)(0)).toBe(true);
    watched.clear();
    document.getElementById('status')!.textContent = 'Queued';
    expect(watched.until!(t, 10)(0)).toBe(false); // forgotten: asked afresh
  });
});
