// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../../src/core/format';
import { createRecorder, comboOf, factsOf } from '../../src/record/index';
import { bestSelector, buildTarget, candidates, isEditableTarget, looksGenerated, meaningful, pathSelector, roleOf, textBlocks, volatileHref, pagePattern } from '../../src/shell/selector.dom';
import { byRoleAndName, bySelector, byText } from '../../src/shell/page.dom';
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
    // Kept by default (security off): only secrets are masked.
    expect(tr.steps.map((s) => s.text)).toEqual(['Two', 'Notes']);
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

describe('targets that stay findable (from the DutyCaptain recording)', () => {
  it('an address with a record id is not a stable selector', () => {
    for (const h of ['/app/tasks/bfd02a18-6a91-4a98-93fa-01e7d7db373d', '/orders/4213', '/u/:r1:', '/p/a1b2c3d4e5f6']) expect(volatileHref(h), h).toBe(true);
    for (const h of ['/app', '/app/tasks/new', '/pricing#plans', '/docs/getting-started', '/team/row-12']) expect(volatileHref(h), h).toBe(false);
    html('<a href="/app/tasks/bfd02a18-6a91-4a98-93fa-01e7d7db373d">T</a>');
    expect(candidates($('a'))).toEqual([]);
  });

  it('tells the same link apart by the landmark around it', () => {
    html(`<aside><nav><a href="/app/tasks/new">New task</a></nav></aside>
      <main><header><a href="/app/tasks/new" id="r:9:">New task</a></header></main>`);
    const [side, head] = Array.from(document.querySelectorAll('a'));
    expect(bestSelector(side, document)).toBe('nav a[href="/app/tasks/new"]');
    expect(bestSelector(head, document)).toBe('header a[href="/app/tasks/new"]');
    for (const el of [side, head]) expect(document.querySelectorAll(bestSelector(el, document)!)).toHaveLength(1);
  });

  it('skips a landmark that is not unique and tries the next one out, or a role', () => {
    html(`<nav aria-label="Main"><div><nav><a href="/x">X</a></nav></div></nav><nav><a href="/x">X</a></nav>
      <div role="banner"><a href="/x">X</a></div>`);
    const links = document.querySelectorAll('a');
    expect(bestSelector(links[0], document)).toBe('nav[aria-label="Main"] a[href="/x"]');
    expect(bestSelector(links[2], document)).toBe('[role="banner"] a[href="/x"]');
    expect(document.querySelector(bestSelector(links[1], document)!)).toBe(links[1]);
  });

  it('a field never carries what was typed in it as its text or name', () => {
    html(`<div contenteditable="true" aria-label="Objective" id="obj">Th</div>
      <div contenteditable="true" id="bare">Hello there</div><div role="textbox" id="rt">abc</div>
      <div contenteditable="true"><p id="inner">x</p></div><div contenteditable="false" id="off">y</div>`);
    expect(buildTarget($('#obj'))).toMatchObject({ sel: '#obj' });
    expect(buildTarget($('#obj')).text).toBeUndefined();
    const bare = buildTarget($('#bare'));
    expect([bare.text, bare.name]).toEqual([undefined, undefined]);
    expect(buildTarget($('#rt'))).not.toHaveProperty('text');
    expect([isEditableTarget($('#inner')), isEditableTarget($('#off')), isEditableTarget($('#rt'))]).toEqual([true, false, true]);
  });

  it('a card is known by its title, not its status, and the player still finds it', () => {
    html(`<a href="/app/tasks/bfd02a18-6a91-4a98-93fa-01e7d7db373d" id="card"><div><span>Queued</span></div>
      <div><p>This is a test task</p><span>just now</span></div><div>2%</div></a><a href="/new">New <b>invoice</b></a>`);
    expect(textBlocks($('#card'))).toEqual(['Queued', 'This is a test task', 'just now', '2%']);
    expect(textBlocks($('a[href="/new"]'))).toEqual(['New invoice']);
    const tgt = buildTarget($('#card'));
    expect(tgt).toMatchObject({ role: 'link', name: 'This is a test task', text: 'This is a test task' });
    expect(tgt.sel).not.toContain('bfd02a18');
    // The status moves on; the card is still found.
    $('#card span').textContent = 'Running';
    expect(byRoleAndName(tgt, document, {} as never)).toBe($('#card'));
    expect(byText(tgt, document, {} as never)).not.toBeNull();
    expect(buildTarget($('a[href="/new"]'))).toMatchObject({ name: 'New invoice', text: 'New invoice' });
  });

  it('a labelled element keeps its label as its name', () => {
    html('<a href="/x" aria-label="Open task"><div>Queued</div><div>Title</div></a>');
    expect(buildTarget($('a'))).toMatchObject({ name: 'Open task' });
    expect(bySelector(buildTarget($('a')), document, {} as never)).toBe($('a'));
  });
});

describe('createRecorder: where it started, gaps and scrolls', () => {
  const fire = (el: EventTarget, type: string, init: Record<string, unknown> = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));

  it('meta.url is the page the recording started on', () => {
    history.pushState({}, '', '/app');
    html('<button id="go">Go</button>');
    let now = 0;
    const rec = createRecorder({ allowSynthetic: true, now: () => now });
    rec.start();
    now = 100; fire($('#go'), 'click');
    history.pushState({}, '', '/app/tasks/123');
    expect(rec.stop()!.meta?.url).toBe('/app');
  });

  it('passes maxGapMs and scrolls through to the trace', () => {
    html('<button id="go">Go</button>');
    let now = 0;
    const run = (o: Parameters<typeof createRecorder>[0]) => {
      const rec = createRecorder({ allowSynthetic: true, now: () => now, ...o });
      now = 0; rec.start();
      now = 1000; document.dispatchEvent(new Event('scroll'));
      now = 30000; fire($('#go'), 'click');
      return rec.stop()!.steps.map((s) => [s.type, s.t]);
    };
    expect(run({})).toEqual([['click', 1500]]); // the scroll is dropped; the 30 s wait becomes 1.5 s
    expect(run({ scrolls: 'all', maxGapMs: 0 })).toEqual([['scroll', 1000], ['click', 30000]]);
  });
});

describe('pages', () => {
  it('pagePattern turns record ids into *', () => {
    expect(pagePattern('/app/tasks/bfd02a18-6a91-4a98-93fa-01e7d7db373d')).toBe('/app/tasks/*');
    expect(pagePattern('/orders/4213/items?x=1')).toBe('/orders/*/items');
    expect(pagePattern('/app/tasks/new/')).toBe('/app/tasks/new');
    expect(pagePattern('/')).toBe('/');
  });

  it('the recorder notes the page of each step as the viewer moves around', () => {
    history.pushState({}, '', '/app');
    html('<button id="go">Go</button>');
    let now = 0;
    const rec = createRecorder({ allowSynthetic: true, now: () => now });
    rec.start();
    now = 100; $('#go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    history.pushState({}, '', '/app/tasks/bfd02a18-6a91-4a98');
    now = 200; $('#go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    now = 300; $('#go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rec.stop()!.steps.map((s) => s.page)).toEqual(['/app', '/app/tasks/*', undefined]);
  });
});

describe('recorder: requires', () => {
  it('copies requires into meta (and leaves it out when empty)', () => {
    html('<button id="go">Go</button>');
    let now = 0;
    const rec = createRecorder({ allowSynthetic: true, now: () => now, requires: ['signed-in'] });
    rec.start();
    now = 10; $('#go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rec.stop()!.meta?.requires).toEqual(['signed-in']);
    const none = createRecorder({ allowSynthetic: true, now: () => now, requires: [] });
    none.start();
    now = 20; $('#go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(none.stop()!.meta).not.toHaveProperty('requires');
  });
});

describe('recorder: across page loads (persistKey)', () => {
  const KEY = 'trace-avatar:rec:t';
  const click = (sel: string, x = 5, y = 5) => $(sel).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  const live: Array<{ destroy(): void }> = [];
  const make = (clock: { now: number; wall: number }, o: Record<string, unknown> = {}) => {
    const r = createRecorder({ allowSynthetic: true, persistKey: 't', now: () => clock.now, wall: () => clock.wall, ...o });
    live.push(r);
    return r;
  };
  afterEach(() => { vi.restoreAllMocks(); for (const r of live.splice(0)) r.destroy(); sessionStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('saves as it goes (debounced) and on pagehide; the next page carries on, the load counting as a gap', () => {
    vi.useFakeTimers();
    html('<button id="a">A</button><input id="f">');
    history.replaceState({}, '', '/one');
    const c = { now: 0, wall: 1_000_000 };
    const first = make(c);
    expect(first.restored).toBe(false);
    first.start();
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ state: 'recording', drafts: [], startUrl: '/one' });
    c.now = 100; click('#a'); // a click is kept at once: it may leave the page
    expect(JSON.parse(sessionStorage.getItem(KEY)!).drafts).toHaveLength(1);
    c.now = 120; ($('#f') as HTMLInputElement).value = 'x'; $('#f').dispatchEvent(new Event('input', { bubbles: true }));
    expect(JSON.parse(sessionStorage.getItem(KEY)!).drafts).toHaveLength(1); // typing waits 300 ms
    vi.advanceTimersByTime(300);
    expect(JSON.parse(sessionStorage.getItem(KEY)!).drafts).toHaveLength(2);
    c.now = 150; $('#a').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 9, clientY: 9 }));
    c.now = 200; c.wall += 200;
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ elapsed: 200, path: [150, 9, 9] });

    // The next page: a new document, a new monotonic clock, 6 s later by the wall clock.
    html('<button id="b">B</button>');
    history.replaceState({}, '', '/two');
    const c2 = { now: 0, wall: c.wall + 6000 };
    const second = make(c2);
    expect(second.restored).toBe(true);
    expect(second.state).toBe('recording');
    expect(second.count).toBe(2);
    c2.now = 50; click('#b');
    const tr = second.stop()!;
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(tr.meta?.url).toBe('/one');
    expect(tr.steps.map((s) => [s.type, s.page])).toEqual([['click', '/one'], ['type', undefined], ['click', '/two']]);
    expect(tr.steps[2].t! - tr.steps[1].t!).toBe(1500 + 0); // 6.15 s in real time, squeezed like any long pause
    first.destroy();
  });

  it('a paused recording stays paused, its clock held', () => {
    html('<button id="a">A</button>');
    const c = { now: 0, wall: 1_000_000 };
    const r = make(c);
    r.start();
    c.now = 100; click('#a');
    c.now = 400; r.pause();
    const next = make({ now: 0, wall: c.wall + 60_000 });
    expect(next.state).toBe('paused');
    next.resume();
    const tr = next.stop()!;
    expect(tr.steps).toHaveLength(1);
  });

  it('back from another site (a sign-in): a "Sign in, then press play" pause step, and signed-in required', () => {
    html('<button id="a">A</button>');
    const c = { now: 0, wall: 1_000_000 };
    const r = make(c, { requires: ['sandbox'] });
    r.start();
    c.now = 100; click('#a');
    c.now = 900; window.dispatchEvent(new Event('pagehide'));
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://auth.example/authorize?x=1');
    const back = make({ now: 0, wall: c.wall + 20_000 }, { requires: ['sandbox'] });
    const tr = back.stop()!;
    expect(tr.steps.map((s) => s.type)).toEqual(['click', 'note']);
    expect(tr.steps[1]).toMatchObject({ say: 'Sign in, then press play.', pause: true, t: 900 });
    expect(tr.meta?.requires).toEqual(['sandbox', 'signed-in']);
  });

  it('a recording from another site, a stale one, or junk is dropped; a new start begins clean', () => {
    const c = { now: 0, wall: 1_000_000 };
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, state: 'recording', elapsed: 1, savedAt: c.wall, origin: 'https://other.example', drafts: [], path: [], touches: 0, pointers: 0 }));
    expect(make(c).restored).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, state: 'recording', elapsed: 1, savedAt: c.wall - 31 * 60_000, origin: location.origin, drafts: [], path: [], touches: 0, pointers: 0 }));
    expect(make(c).restored).toBe(false);
    sessionStorage.setItem(KEY, '{nope');
    expect(make(c).restored).toBe(false);
    expect(make(c).restored).toBe(false); // nothing kept: nothing to drop
  });

  it('full storage keeps the steps without the path; storage that throws only means no carrying on', () => {
    html('<button id="a">A</button>');
    const c = { now: 0, wall: 1_000_000 };
    const real = sessionStorage.setItem.bind(sessionStorage);
    const writes: string[] = [];
    vi.spyOn(sessionStorage, 'setItem').mockImplementation((k: string, v: string) => {
        if (k === KEY && JSON.parse(v).path.length) throw new Error('quota');
      writes.push(v);
      real(k, v);
    });
    const r = make(c);
    r.start();
    c.now = 50; $('#a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 3, clientY: 3 }));
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(writes[writes.length - 1]).path).toEqual([]);
    vi.restoreAllMocks();
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('off'); });
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => { throw new Error('off'); });
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('off'); });
    const off = make(c);
    off.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(off.stop()).toBeNull();
    r.destroy();
  });

  it('destroy forgets the kept recording and stops listening for pagehide; without a key nothing is kept', () => {
    vi.useFakeTimers();
    html('<input id="f">');
    const c = { now: 0, wall: 1_000_000 };
    const r = make(c);
    r.start();
    c.now = 10; ($('#f') as HTMLInputElement).value = 'x'; $('#f').dispatchEvent(new Event('input', { bubbles: true })); // a save is pending
    r.destroy();
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('pagehide'));
    expect(sessionStorage.getItem(KEY)).toBeNull();
    const plain = createRecorder({ allowSynthetic: true, now: () => c.now });
    plain.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(sessionStorage.length).toBe(0);
    plain.destroy();
  });
});

describe('recorder: studio hooks (caption, waitFor, mark)', () => {
  const click = (sel: string) => $(sel).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
  const typeIn = (sel: string, v: string) => { ($(sel) as HTMLInputElement).value = v; $(sel).dispatchEvent(new Event('input', { bubbles: true })); };

  it('caption goes on the last step (kept through typing merges); with no step yet it is a note', () => {
    html('<button id="a">Save</button><input id="f" data-trace-reveal>');
    let now = 0;
    const r = createRecorder({ allowSynthetic: true, now: () => now });
    r.caption('ignored: not recording');
    r.start();
    now = 10; r.caption('  Welcome  ');
    now = 20; click('#a');
    now = 30; r.caption('Save the draft');
    now = 40; typeIn('#f', 'A');
    now = 50; r.caption('Name it');
    now = 60; typeIn('#f', 'Ada'); // merges into the first type step
    now = 70; r.caption('   '); // blank: nothing
    expect(r.elapsed).toBe(70);
    const tr = r.stop()!;
    expect(tr.steps.map((s) => [s.type, s.say])).toEqual([['note', 'Welcome'], ['click', 'Save the draft'], ['type', 'Name it']]);
    expect(tr.steps[2].text).toBe('Ada');
    expect(parse(tr).ok).toBe(true);
    expect(r.elapsed).toBe(70);
  });

  it('waitFor adds a wait step with until, on an element or the page, and keeps it out of scroll pruning', () => {
    html('<div id="status">Saving…</div><div id="spin">…</div>');
    let now = 0;
    const r = createRecorder({ allowSynthetic: true, now: () => now });
    r.waitFor($('#status'), { text: 'Saved' }); // not recording: nothing
    r.start();
    now = 10; r.waitFor($('#status'), { text: 'Saved' });
    now = 20; r.waitFor($('#spin'), { gone: true });
    now = 30; r.waitFor(null, { text: 'Done' });
    const tr = r.stop()!;
    expect(tr.steps).toHaveLength(3);
    expect(tr.steps[0]).toMatchObject({ type: 'wait', until: { text: 'Saved' }, target: { sel: '#status' } });
    expect(tr.steps[1]).toMatchObject({ type: 'wait', until: { gone: true }, target: { sel: '#spin' } });
    expect(tr.steps[2]).toEqual({ type: 'wait', t: 30, until: { text: 'Done' } });
    expect(parse(tr).ok).toBe(true);
  });

  it('mark masks or reveals a field for this recording (security on: masked by default); a password can never be revealed', () => {
    html('<input id="name"><input id="code" data-trace-reveal><input id="pw" type="password">');
    let now = 0;
    const r = createRecorder({ allowSynthetic: true, now: () => now, security: true });
    expect(r.mark($('#name'), 'reveal')).toBe(false);
    expect(r.mark($('#code'), 'mask')).toBe(true);
    expect(r.mark($('#pw'), 'reveal')).toBe(true);
    r.start();
    now = 10; typeIn('#name', 'Ada');
    now = 3000; typeIn('#code', 'X1');
    now = 6000; typeIn('#pw', 'hunter2');
    let tr = r.stop()!;
    expect(tr.steps.map((s) => [s.text, !!s.mask])).toEqual([['Ada', false], ['••', true], ['•••••••', true]]);
    // Back to the defaults.
    const r2 = createRecorder({ allowSynthetic: true, now: () => now, security: true });
    r2.mark($('#name'), 'reveal');
    expect(r2.mark($('#name'), null)).toBe(true);
    r2.start();
    typeIn('#name', 'Bo');
    tr = r2.stop()!;
    expect(tr.steps[0]).toMatchObject({ text: '••', mask: true });
  });

  it('by default typed text is kept and passwords are not; money is masked under the money guard', () => {
    html('<input id="name"><input id="pw" type="password"><input id="amount" name="amount">');
    let now = 0;
    const r = createRecorder({ allowSynthetic: true, now: () => now });
    r.start();
    now = 10; typeIn('#name', 'Ada');
    now = 3000; typeIn('#pw', 'hunter2');
    now = 6000; typeIn('#amount', '5000');
    expect(r.stop()!.steps.map((s) => [s.text, !!s.mask])).toEqual([['Ada', false], ['•••••••', true], ['5000', false]]);
    const m = createRecorder({ allowSynthetic: true, now: () => now, security: ['money'] });
    m.start();
    now = 9000; typeIn('#name', 'Bo');
    now = 12000; typeIn('#amount', '70');
    // Any guard masks by default; money fields are masked even if the default is turned off.
    expect(m.stop()!.steps.map((s) => s.text)).toEqual(['••', '••']);
    const off = createRecorder({ allowSynthetic: true, now: () => now, security: ['money'], maskByDefault: false });
    off.start();
    now = 15000; typeIn('#name', 'Cy');
    now = 18000; typeIn('#amount', '9');
    expect(off.stop()!.steps.map((s) => s.text)).toEqual(['Cy', '•']);
  });

  it('a chosen file is an upload step on what opened the picker (the input hidden), with small content kept', async () => {
    html('<button id="attach">Attach files</button><input id="file" type="file" style="display:none">');
    const input = $('#file') as HTMLInputElement;
    Object.defineProperty(input, 'getClientRects', { value: () => [] });
    let now = 0;
    const fire = (el: EventTarget, type: string) => el.dispatchEvent(type === 'click' ? new MouseEvent(type, { bubbles: true }) : new Event(type, { bubbles: true }));
    const pick = async (rec: ReturnType<typeof createRecorder>, file: File) => {
      rec.start();
      now += 10; fire($('#attach'), 'click');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      now += 4000; fire(input, 'change');
      await new Promise((r) => { setTimeout(r, 20); });
      return rec.stop()!;
    };
    const csv = new File(['item,price\n'], 'prices.csv', { type: 'text/csv' });
    const tr = await pick(createRecorder({ allowSynthetic: true, now: () => now }), csv);
    expect(tr.steps).toHaveLength(1);
    expect(tr.steps[0]).toMatchObject({ type: 'upload', target: { role: 'button', name: 'Attach files' }, files: [{ name: 'prices.csv', type: 'text/csv', size: 11 }] });
    expect(tr.steps[0].files![0].url).toMatch(/^data:text\/csv;base64,/);
    // Under the files guard (or over the size), only the name, type and size are kept.
    const held = await pick(createRecorder({ allowSynthetic: true, now: () => now, security: ['files'] }), csv);
    expect(held.steps[0].files).toEqual([{ name: 'prices.csv', type: 'text/csv', size: 11 }]);
  });
});
