// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../../src/core/format';
import { createRecorder, comboOf, factsOf } from '../../src/record/index';
import { bestSelector, buildTarget, candidates, looksGenerated, meaningful, pathSelector, roleOf } from '../../src/shell/selector.dom';
import { html, setRect } from './dom-helpers';

afterEach(() => { document.body.innerHTML = ''; });
const $ = (sel: string) => document.querySelector(sel)!;

describe('looksGenerated', () => {
  it('flags framework and hashed ids, keeps human ones', () => {
    for (const id of [':r3:', 'ember123', 'radix-5', 'headlessui-menu-1', 'mui-42', '9lives', 'a1b2c3d4e5', 'item-20260108', 'rc_select_0', 'id-3']) expect(looksGenerated(id), id).toBe(true);
    for (const id of ['save', 'customer-name', 'row-12', 'btn2', 'main-nav']) expect(looksGenerated(id), id).toBe(false);
  });
});

describe('candidates / bestSelector / pathSelector', () => {
  it('prefers test attributes, then a stable id, name, aria-label, a short href', () => {
    html('<button id="save" data-testid="save-btn" name="s" aria-label="Save it">Save</button><a href="/pricing" id="r:1:">P</a>');
    expect(candidates($('#save'))).toEqual(['[data-testid="save-btn"]', '#save', 'button[name="s"]', 'button[aria-label="Save it"]']);
    expect(candidates($('a'))).toEqual(['a[href="/pricing"]']);
    expect(bestSelector($('#save'), document)).toBe('[data-testid="save-btn"]');
  });

  it('skips candidates that are not unique', () => {
    html('<button name="go">A</button><button name="go" id="two">B</button>');
    expect(bestSelector($('#two'), document)).toBe('#two');
  });

  it('falls back to a structural path, anchored at a stable ancestor', () => {
    html('<div id="toolbar"><span><b>x</b></span><span><b>y</b></span></div><div><span><b>z</b></span></div>');
    const y = document.querySelectorAll('b')[1];
    const sel = pathSelector(y, document)!;
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(y);
    expect(sel).toContain('nth-of-type(2)');
    const z = document.querySelectorAll('b')[2];
    expect(document.querySelector(bestSelector(z, document)!)).toBe(z);
  });

  it('escapes awkward values', () => {
    html('<button data-testid=\'say "hi"\'>x</button><div id="a.b">y</div>');
    const sel = bestSelector($('button'), document)!;
    expect(document.querySelector(sel)).toBe($('button'));
    expect(document.querySelector(bestSelector(document.getElementById('a.b')!, document)!)).toBe(document.getElementById('a.b'));
  });

  it('works relative to a root', () => {
    html('<section id="s"><p>a</p><p>b</p></section><p>c</p>');
    const root = $('#s');
    const p = root.querySelectorAll('p')[1];
    const sel = bestSelector(p, root)!;
    expect(root.querySelector(sel)).toBe(p);
  });
});

describe('roleOf / meaningful', () => {
  it('knows explicit and implicit roles', () => {
    html('<div role="tab menuitem" id="t"></div><button id="b"></button><a href="#" id="l"></a><a id="na"></a><input id="i"><input type="checkbox" id="c"><input type="submit" id="s"><select id="sel"></select><textarea id="ta"></textarea><h3 id="h"></h3><summary id="su"></summary><input type="range" id="r"><input type="radio" id="ra"><p id="p"></p>');
    const r = (id: string) => roleOf(document.getElementById(id)!);
    expect([r('t'), r('b'), r('l'), r('na'), r('i'), r('c'), r('s'), r('sel'), r('ta'), r('h'), r('su'), r('r'), r('ra'), r('p')])
      .toEqual(['tab', 'button', 'link', null, 'textbox', 'checkbox', 'button', 'combobox', 'textbox', 'heading', 'button', 'slider', 'radio', null]);
  });
  it('climbs from an icon to the control around it', () => {
    html('<button id="b"><svg><path id="icon"></path></svg></button><p><span id="s">x</span></p>');
    expect(meaningful(document.getElementById('icon')!).id).toBe('b');
    expect(meaningful(document.getElementById('s')!).id).toBe('s');
  });
});

describe('buildTarget', () => {
  it('records selector, role + name, text, where on the element and the pixel point', () => {
    html('<button id="save">Save invoice</button>');
    setRect($('#save'), 100, 200, 100, 40);
    expect(buildTarget($('#save'), { point: { x: 110, y: 205 } })).toEqual({
      sel: '#save', role: 'button', name: 'Save invoice', text: 'Save invoice', at: { rx: 0.1, ry: 0.13 }, xy: { x: 110, y: 205 },
    });
  });
  it('leaves out `at` near the centre, text on fields, and long names', () => {
    html(`<label for="c">Customer</label><input id="c"><button id="long">${'x'.repeat(90)}</button>`);
    setRect($('#c'), 0, 0, 200, 40);
    expect(buildTarget($('#c'), { point: { x: 100, y: 20 } })).toEqual({ sel: '#c', role: 'textbox', name: 'Customer', xy: { x: 100, y: 20 } });
    const t = buildTarget($('#long'));
    expect(t.role).toBeUndefined();
    expect(t.text).toBeUndefined();
    const r = $('#long').getBoundingClientRect();
    expect(t.xy).toEqual({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  });
  it('a recorded target is found again by the player', () => {
    html('<nav><a href="/a">A</a><a href="/b">B</a></nav>');
    const t = buildTarget(document.querySelectorAll('a')[1]);
    const r = parse({ version: 1, steps: [{ type: 'click', target: t }] });
    expect(r.ok).toBe(true);
    expect(document.querySelector(t.sel!)).toBe(document.querySelectorAll('a')[1]);
  });
});

describe('comboOf / factsOf', () => {
  const k = (key: string, m: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });
  it('names shortcuts and ignores plain typing', () => {
    expect(comboOf(k('k', { metaKey: true }), true)).toBe('Mod+K');
    expect(comboOf(k('k', { ctrlKey: true }), false)).toBe('Mod+K');
    expect(comboOf(k('k', { ctrlKey: true }), true)).toBe('Ctrl+K');
    expect(comboOf(k('k', { metaKey: true }), false)).toBe('Meta+K');
    expect(comboOf(k('Enter', { shiftKey: true }), false)).toBe('Shift+Enter');
    expect(comboOf(k('Tab'), false)).toBe('Tab');
    expect(comboOf(k('ArrowUp', { altKey: true }), false)).toBe('Alt+ArrowUp');
    expect(comboOf(k('a'), false)).toBeNull();
    expect(comboOf(k('A', { shiftKey: true }), false)).toBeNull();
    expect(comboOf(k('Shift', { shiftKey: true }), false)).toBeNull();
  });
  it('collects field facts, including marks on ancestors', () => {
    html('<form data-trace-reveal><input id="n" name="customer" type="Email" autocomplete="email"></form><div data-trace-mask><textarea id="t"></textarea></div>');
    expect(factsOf($('#n'))).toEqual({ tag: 'input', type: 'email', autocomplete: 'email', name: 'customer', id: 'n', marked: false, revealed: true });
    expect(factsOf($('#t'))).toMatchObject({ tag: 'textarea', marked: true, revealed: false });
  });
});

describe('createRecorder', () => {
  const setup = () => {
    html(`
      <button id="save">Save</button>
      <input id="name" data-trace-reveal>
      <input id="secret">
      <input id="pw" type="password" data-trace-reveal>
      <input id="cb" type="checkbox">
      <select id="sel"><option>One</option><option>Two</option></select>
      <div id="ce" contenteditable="true"></div>
      <div id="panel" style="overflow:auto"></div>
      <div data-trace-ignore><button id="ignored">x</button></div>
    `);
    let now = 0;
    const rec = createRecorder({ allowSynthetic: true, now: () => now, title: 'Demo', avatar: { name: 'Ada' } });
    const at = (t: number) => { now = t; };
    return { rec, at };
  };
  const fire = (el: EventTarget, type: string, init: Record<string, unknown> = {}) => {
    const ctor = type.startsWith('pointer') ? (window as any).PointerEvent ?? MouseEvent : /click/.test(type) ? MouseEvent : type === 'keydown' ? KeyboardEvent : Event;
    el.dispatchEvent(new ctor(type, { bubbles: true, ...init }));
  };
  const typeInto = (el: HTMLInputElement | HTMLElement, value: string) => {
    if ('value' in el) (el as HTMLInputElement).value = value; else el.textContent = value;
    fire(el, 'input');
  };

  it('records clicks, typing, keys, scrolls and pointer moves into a valid trace', () => {
    const { rec, at } = setup();
    const states: string[] = [];
    rec.on('state', (s) => states.push(s.state));
    rec.start();
    at(100); fire($('#save'), 'pointermove', { clientX: 10, clientY: 10 });
    at(140); fire($('#save'), 'pointermove', { clientX: 50, clientY: 20 });
    at(150); fire($('#save'), 'pointermove', { clientX: 60, clientY: 30 }); // inside 33ms: dropped
    at(200); fire($('#save'), 'pointerdown', { clientX: 70, clientY: 30 });
    fire($('#save'), 'click', { clientX: 70, clientY: 30 });
    at(1000); typeInto($('#name') as HTMLInputElement, 'A');
    at(1100); typeInto($('#name') as HTMLInputElement, 'Ada');
    at(1500); fire($('#name'), 'keydown', { key: 'Enter' });
    at(1600); fire($('#name'), 'keydown', { key: 'x' });
    at(2000); (window as any).scrollY; fire(document, 'scroll');
    at(2500); ($('#panel') as HTMLElement).scrollTop = 40; fire($('#panel'), 'scroll');
    expect(rec.count).toBe(6);
    const tr = rec.stop()!;
    expect(states).toEqual(['recording', 'stopped']);
    expect(parse(tr).ok).toBe(true);
    expect(tr.steps.map((s) => s.type)).toEqual(['click', 'type', 'key', 'scroll', 'scroll']);
    expect(tr.steps[0]).toMatchObject({ t: 200, target: { sel: '#save', role: 'button', name: 'Save' } });
    expect(tr.steps[1]).toMatchObject({ t: 1000, text: 'Ada' });
    expect(tr.steps[1].mask).toBeUndefined();
    expect(tr.steps[2]).toEqual({ type: 'key', t: 1500, keys: 'Enter' });
    expect(tr.steps[4]).toMatchObject({ target: { sel: '#panel' }, to: { y: 40 } });
    expect(tr.meta).toMatchObject({ title: 'Demo', viewport: { w: window.innerWidth, h: window.innerHeight } });
    expect(tr.avatar).toEqual({ name: 'Ada' });
    expect((tr.path as number[][]).map((p) => p[0])).toEqual([100, 140, 200]);
  });

  it('masks by default and always masks secrets', () => {
    const { rec, at } = setup();
    rec.start();
    at(10); typeInto($('#secret') as HTMLInputElement, 'hello');
    at(5000); typeInto($('#pw') as HTMLInputElement, 'hunter2');
    const tr = rec.stop()!;
    expect(tr.steps.map((s) => [s.text, s.mask])).toEqual([['•••••', true], ['•••••••', true]]);
    expect(JSON.stringify(tr)).not.toMatch(/hello|hunter2/);
  });

  it('records a select by its option text and contenteditable by its text; ignores checkbox input', () => {
    const { rec, at } = setup();
    rec.start();
    at(10); ($('#sel') as HTMLSelectElement).selectedIndex = 1; fire($('#sel'), 'change');
    at(3000); typeInto($('#ce') as HTMLElement, 'Notes');
    at(6000); fire($('#cb'), 'input');
    const tr = rec.stop()!;
    expect(tr.steps.map((s) => s.text)).toEqual(['Two', '•••••']);
  });

  it('ignores [data-trace-ignore], the overlay, and synthetic events by default', () => {
    const { rec } = setup();
    rec.start();
    fire($('#ignored'), 'click');
    const host = document.createElement('div');
    host.setAttribute('data-trace-avatar', '');
    document.body.appendChild(host);
    fire(host, 'click');
    expect(rec.stop()).toBeNull();
    const strict = createRecorder();
    strict.start();
    fire($('#save'), 'click');
    fire($('#save'), 'pointerdown');
    fire($('#save'), 'pointermove');
    fire(document, 'scroll');
    expect(strict.count).toBe(0);
    expect(strict.stop()).toBeNull();
  });

  it('pause leaves out time and events; resume carries on', () => {
    const { rec, at } = setup();
    rec.start();
    at(100); fire($('#save'), 'click');
    at(200); rec.pause();
    expect(rec.state).toBe('paused');
    at(5000); fire($('#save'), 'click');
    rec.resume();
    at(5100); fire($('#name'), 'click');
    const tr = rec.stop()!;
    expect(tr.steps.map((s) => s.t)).toEqual([100, 300]);
  });

  it('stops listening after stop and destroy; start again begins afresh', () => {
    const { rec, at } = setup();
    expect(rec.stop()).toBeNull(); // not started
    rec.start();
    at(10); fire($('#save'), 'click');
    rec.stop();
    fire($('#save'), 'click');
    expect(rec.count).toBe(1);
    rec.start();
    expect(rec.count).toBe(0);
    rec.destroy();
    fire($('#save'), 'click');
    expect(rec.count).toBe(0);
    expect(rec.state).toBe('stopped');
  });

  it('emits each captured action as a draft', () => {
    const { rec } = setup();
    const drafts = vi.fn();
    rec.on('draft', drafts);
    rec.start();
    fire($('#save'), 'click');
    expect(drafts).toHaveBeenCalledWith(expect.objectContaining({ kind: 'click' }));
  });

  it('marks touch recordings and truncated paths', () => {
    html('<button id="b">B</button>');
    let now = 0;
    const rec = createRecorder({ allowSynthetic: true, now: () => now, maxSamples: 2 });
    rec.start();
    for (let i = 0; i < 4; i += 1) { now += 50; fire($('#b'), 'pointerdown', { pointerType: 'touch', clientX: i, clientY: i }); }
    fire($('#b'), 'click');
    const tr = rec.stop()!;
    expect(tr.meta).toMatchObject({ pointer: 'touch', truncated: true });
  });

  it('keepPath: false leaves the pointer path out', () => {
    html('<button id="b">B</button>');
    let now = 0;
    const rec = createRecorder({ allowSynthetic: true, now: () => now, keepPath: false });
    rec.start();
    for (let i = 0; i < 5; i += 1) { now += 50; fire($('#b'), 'pointermove', { clientX: i * 10, clientY: 0 }); }
    fire($('#b'), 'click');
    expect(rec.stop()!.path).toBeUndefined();
  });
});
