// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUESS_MIN, offerFix } from '../../src/fix/index';
import type { Fix, FixOptions } from '../../src/fix/index';
import { defaultLoaders, mount } from '../../src/auto/index';
import type { FixModule, GuidesController, Manifest, PlayerModule } from '../../src/auto/index';
import { createEmitter } from '../../src/shell/emitter';
import type { TraceController, TraceEvents, TraceOptions } from '../../src/index';
import type { Trace } from '../../src/core/format';
import { html } from './dom-helpers';

/** resolvesTo can be told to refuse, to test a pick that can't be told apart. */
const refuse = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/repair/index', async (orig) => {
  const m = await orig<typeof import('../../src/repair/index')>();
  return { ...m, resolvesTo: (...a: Parameters<typeof m.resolvesTo>) => !refuse.on && m.resolvesTo(...a) };
});

const TRACE: Trace = {
  version: 1,
  meta: { title: 'Make an invoice' },
  steps: [
    { type: 'click', target: { role: 'button', name: 'New invoice' }, say: 'Start one' },
    { type: 'click', target: { role: 'button', name: 'Save invoice' }, say: 'Save it' },
    { type: 'note', say: 'Done' },
  ],
};
const ENTRY = { id: 'invoice', title: 'Make an invoice', trace: 'traces/invoice.trace.json' };

const tick = async (n = 10) => { for (let k = 0; k < n; k += 1) await Promise.resolve(); };
const host = () => document.querySelector('[data-trace-avatar="fix"]') as HTMLElement | null;
const card = () => host()?.shadowRoot?.querySelector('.card') as HTMLElement | null;
const msg = () => card()?.querySelector('.msg')?.textContent ?? '';
const buttons = () => Array.from(card()?.querySelectorAll('button') ?? []).map((b) => b.textContent);
const press = (label: string) => {
  const b = Array.from(card()!.querySelectorAll('button')).find((x) => x.textContent === label);
  if (!b) throw new Error(`no button "${label}" in ${JSON.stringify(buttons())}`);
  b.click();
};

let fixes: Fix[] = [];
const open = (o: Partial<FixOptions> = {}) => {
  const onFixed = vi.fn();
  const onStop = vi.fn();
  const f = offerFix({ trace: TRACE, index: 1, entry: ENTRY, onFixed, onStop, ...o });
  fixes.push(f);
  return { f, onFixed, onStop };
};

beforeEach(() => { refuse.on = false; });
afterEach(() => { fixes.forEach((f) => f.close()); fixes = []; document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('offerFix: the card', () => {
  it('offers to fix the step it names; Stop closes it and says so', () => {
    html('<button>Store invoice</button>');
    const { f, onStop } = open();
    expect(f.state).toBe('offer');
    expect(card()!.getAttribute('role')).toBe('dialog');
    expect(card()!.getAttribute('aria-label')).toBe('Fix this step');
    expect(msg()).toBe('Step 2 can’t find button “Save invoice”.');
    expect(buttons()).toEqual(['Fix this step', 'Stop']);
    press('Stop');
    expect(onStop).toHaveBeenCalledOnce();
    expect(f.state).toBe('closed');
    expect(host()).toBeNull();
  });

  it('guesses the renamed element; Yes re-records it, carries on and leaves the given trace alone', async () => {
    html('<h2>Invoice</h2><button id="cancel">Cancel</button><button id="store">Store invoice</button><button>Delete</button>');
    const before = JSON.stringify(TRACE);
    const { f, onFixed } = open();
    press('Fix this step');
    await tick();
    expect(f.state).toBe('guess');
    expect(msg()).toMatch(/^Is it this\? \(button “Store invoice”\)$/);
    expect(buttons()).toEqual(['Yes', 'No, I’ll point at it', 'Cancel']);
    press('Yes');
    expect(f.state).toBe('fixed');
    expect(onFixed).toHaveBeenCalledOnce();
    const [fixed, index] = onFixed.mock.calls[0] as [Trace, number];
    expect(index).toBe(1);
    expect(fixed.steps[1]).toMatchObject({ type: 'click', say: 'Save it', target: { role: 'button', name: 'Store invoice' } });
    expect(fixed.steps[0]).toEqual(TRACE.steps[0]);
    expect(JSON.stringify(TRACE)).toBe(before);
    expect(msg()).toBe('Fixed step 2: button “Store invoice”.');
    expect(buttons()).toEqual(['Save the guide', 'Just this time']);
    press('Just this time');
    expect(f.state).toBe('closed');
  });

  it('Cancel on a guess goes back to the offer', async () => {
    html('<button>Store invoice</button>');
    const { f } = open();
    press('Fix this step');
    await tick();
    press('Cancel');
    expect(f.state).toBe('offer');
    expect(buttons()).toEqual(['Fix this step', 'Stop']);
  });

  it('with no good guess (below GUESS_MIN, no AI) it asks the author to point', async () => {
    expect(GUESS_MIN).toBe(0.5);
    html('<button>Archive</button><a href="#">Help</a>');
    const { f } = open();
    press('Fix this step');
    await tick();
    expect(f.state).toBe('point');
    expect(msg()).toBe('Click the element this step should use. Esc to cancel.');
  });

  it('asks the AI only when the scores are unsure, and shows its pick; an AI that fails means pointing', async () => {
    html('<button>Archive</button><button>Keep</button>');
    const ai = vi.fn(async (_task: string, input: unknown) => {
      const c = (input as { candidates: Array<{ id: number; name: string }> }).candidates.find((x) => x.name === 'Keep')!;
      return { id: c.id, why: 'Keep is the new Save' };
    });
    const a = open({ ai });
    press('Fix this step');
    await tick();
    expect(ai).toHaveBeenCalledOnce();
    expect(ai.mock.calls[0][0]).toBe('repair');
    expect(a.f.state).toBe('guess');
    expect(msg()).toContain('“Keep”');
    a.f.close();

    const bad = open({ ai: vi.fn(async () => { throw new Error('quota'); }) });
    press('Fix this step');
    await tick();
    expect(bad.f.state).toBe('point');
  });

  it('a clear winner needs no AI', async () => {
    html('<button>Save invoice now</button><button>Cancel</button>');
    const ai = vi.fn();
    const { f } = open({ ai });
    press('Fix this step');
    await tick();
    expect(f.state).toBe('guess');
    expect(ai).not.toHaveBeenCalled();
  });
});

describe('offerFix: pointing', () => {
  it('the click picks the element and never reaches the app; presses are held back too', async () => {
    html('<button id="arch">Archive</button>');
    const app = vi.fn();
    const el = document.getElementById('arch')!;
    for (const t of ['click', 'mousedown', 'pointerdown', 'mouseup']) el.addEventListener(t, app);
    const { f, onFixed } = open();
    press('Fix this step');
    await tick();
    expect(f.state).toBe('point');
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    for (const t of ['pointerdown', 'mousedown', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
    el.click();
    expect(app).not.toHaveBeenCalled();
    expect(f.state).toBe('fixed');
    expect((onFixed.mock.calls[0][0] as Trace).steps[1].target).toMatchObject({ role: 'button', name: 'Archive' });
    // Pointing is over: the app gets its clicks again.
    el.click();
    expect(app).toHaveBeenCalledTimes(1);
  });

  it('Esc goes back to the offer and the page works again', async () => {
    html('<button id="arch">Archive</button>');
    const app = vi.fn();
    document.getElementById('arch')!.addEventListener('click', app);
    const { f } = open();
    press('Fix this step');
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.state).toBe('offer');
    document.getElementById('arch')!.click();
    expect(app).toHaveBeenCalledOnce();
  });

  it('clicks on the card itself are the card’s, not picks', async () => {
    html('<button>Archive</button>');
    const { f } = open();
    press('Fix this step');
    await tick();
    press('Cancel');
    expect(f.state).toBe('offer');
  });

  it('a pick the player could not find again is refused; pointing goes on', async () => {
    html('<button id="arch">Archive</button>');
    const { f, onFixed } = open();
    press('Fix this step');
    await tick();
    refuse.on = true;
    document.getElementById('arch')!.click();
    expect(onFixed).not.toHaveBeenCalled();
    expect(f.state).toBe('point');
    expect(msg()).toMatch(/can’t be told apart/);
    refuse.on = false;
    document.getElementById('arch')!.click();
    expect(f.state).toBe('fixed');
  });

  it('a refused guess turns into pointing', async () => {
    html('<button>Store invoice</button>');
    const { f } = open();
    press('Fix this step');
    await tick();
    refuse.on = true;
    press('Yes');
    expect(f.state).toBe('point');
    expect(msg()).toMatch(/can’t be told apart/);
  });
});

describe('offerFix: saving', () => {
  it('Save the guide hands the fixed trace and the entry to save; a failure can be tried again', async () => {
    html('<button>Store invoice</button>');
    let fail = true;
    const save = vi.fn(async () => { if (fail) throw new Error('403'); });
    const { f } = open({ save });
    press('Fix this step');
    await tick();
    press('Yes');
    press('Save the guide');
    await tick();
    expect(save).toHaveBeenCalledOnce();
    const [t, entry] = save.mock.calls[0] as unknown as [Trace, typeof ENTRY];
    expect(entry).toEqual(ENTRY);
    expect(t.steps[1].target).toMatchObject({ name: 'Store invoice' });
    expect(msg()).toBe('Could not save: 403');
    fail = false;
    press('Try again');
    await tick();
    expect(save).toHaveBeenCalledTimes(2);
    expect(msg()).toBe('Saved: the guide is fixed for everyone.');
    press('Close');
    expect(f.state).toBe('closed');
  });

  it('without save, the fixed guide is downloaded as <id>.trace.json', async () => {
    html('<button>Store invoice</button>');
    const blobs: Blob[] = [];
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => { blobs.push(b); return 'blob:x'; };
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    open();
    press('Fix this step');
    await tick();
    press('Yes');
    press('Save the guide');
    await tick();
    expect(names).toEqual(['invoice.trace.json']);
    const saved = JSON.parse(await blobs[0].text()) as Trace;
    expect(saved.steps[1].target).toMatchObject({ name: 'Store invoice' });
    expect(msg()).toBe('Downloaded invoice.trace.json, fixed.');
  });
});

// ── mount: who sees the card, and what a fix changes ──────────────────────

function fakePlayer() {
  const made: Array<{ opts: TraceOptions; ctl: TraceController & { emit: <K extends keyof TraceEvents>(k: K, d: TraceEvents[K]) => void; destroyed: boolean } }> = [];
  const mod: PlayerModule = {
    createTrace(opts) {
      const em = createEmitter<TraceEvents>();
      const ctl = { ready: Promise.resolve(), state: 'playing', destroyed: false, play() {}, destroy() { ctl.destroyed = true; }, on: em.on, emit: em.emit } as unknown as (typeof made)[number]['ctl'];
      made.push({ opts, ctl });
      return ctl;
    },
  };
  return { mod, made, load: vi.fn(async () => mod) };
}

function fakeFix() {
  const made: Array<{ o: FixOptions; state: Fix['state']; closed: number }> = [];
  const mod: FixModule = {
    offerFix(o) {
      const r = { o, state: 'offer' as Fix['state'], closed: 0 };
      made.push(r);
      return { get state() { return r.state; }, close() { r.closed += 1; r.state = 'closed'; } };
    },
  };
  return { made, load: vi.fn(async () => mod) };
}

const INLINE: Trace = { version: 1, steps: [{ type: 'click', target: { role: 'button', name: 'A' } }, { type: 'click', target: { role: 'button', name: 'Save' } }] };
const MANIFEST: Manifest = {
  version: 1,
  guides: [
    { id: 'inline', title: 'Inline', trace: INLINE, modes: ['overlay', 'perform'] },
    { id: 'remote', title: 'Remote', trace: 'traces/remote.trace.json', tags: ['x'] },
  ],
};

// ── E8: a wait whose text changed ─────────────────────────────────────────

const WAIT: Trace = {
  version: 1,
  meta: { title: 'Save an invoice' },
  steps: [
    { type: 'type', target: { role: 'textbox', name: 'Customer' }, text: 'Ada Stores' },
    { type: 'click', target: { role: 'button', name: 'Save' }, say: 'Save it' },
    { type: 'wait', until: { text: 'Saved' }, say: 'Saving…' },
    { type: 'note', say: 'Done' },
  ],
};
const openWait = (o: Partial<FixOptions> = {}) => open({ trace: WAIT, index: 2, reason: 'until-timeout', ...o });

describe('offerFix: a wait whose text never showed', () => {
  it('names the text it waited for, and offers Fix, Remove this wait and Stop', () => {
    html('<p>Changes saved</p>');
    openWait();
    expect(msg()).toBe('Step 3 waited for “Saved”, which never showed.');
    expect(buttons()).toEqual(['Fix this step', 'Remove this wait', 'Stop']);
  });

  it('guesses the new wording on the page; Yes sets until.text and carries on after the wait', async () => {
    html('<h2>Invoices</h2><p>Changes saved</p><p>Total</p>');
    const { f, onFixed } = openWait();
    press('Fix this step');
    await tick();
    expect(f.state).toBe('guess');
    expect(msg()).toBe('Is it “Changes saved”?');
    expect(buttons()).toEqual(['Yes', 'No, I’ll point at it', 'Cancel']);
    press('Yes');
    const [fixed, from] = onFixed.mock.calls[0] as [Trace, number];
    expect(fixed.steps[2]).toEqual({ type: 'wait', until: { text: 'Changes saved' }, say: 'Saving…' });
    expect(from).toBe(3);
    expect(msg()).toBe('Fixed step 3: it waits for “Changes saved”.');
    expect(WAIT.steps[2].until).toEqual({ text: 'Saved' });
  });

  it('a toast that came and went is still guessed, as seen while waiting', async () => {
    html('<p>Invoices</p>');
    const { onFixed } = openWait({ seen: ['Invoice stored'] });
    press('Fix this step');
    await tick();
    expect(msg()).toBe('Is it “Invoice stored”? (seen while waiting)');
    press('Yes');
    expect((onFixed.mock.calls[0][0] as Trace).steps[2].until).toEqual({ text: 'Invoice stored' });
  });

  it('a text that shows a typed value is never offered', async () => {
    html('<p>Saved Ada Stores</p>');
    const ai = vi.fn();
    const { f } = openWait({ ai });
    press('Fix this step');
    await tick();
    expect(f.state).toBe('point');
    expect(ai).not.toHaveBeenCalled();   // nothing left to send
  });

  it('asks the AI when unsure; a part of a text it names is kept, text not on the page is dropped', async () => {
    html('<p>Invoice 12 stored at 14:02</p><p>Payment received</p>');
    const ai = vi.fn(async () => ({ id: 0, text: 'stored', why: 'same meaning' }));
    const { onFixed } = openWait({ ai });
    press('Fix this step');
    await tick();
    expect(ai).toHaveBeenCalledWith('repair-wait', expect.anything(), expect.anything(), expect.anything());
    expect(msg()).toBe('Is it “stored”?');
    press('Yes');
    expect((onFixed.mock.calls[0][0] as Trace).steps[2].until).toEqual({ text: 'stored' });
    fixes.forEach((x) => x.close());
    const made = vi.fn(async () => ({ id: 0, text: 'Saved!' }));
    const { f } = openWait({ ai: made });
    press('Fix this step');
    await tick();
    expect(f.state).toBe('point');
  });

  it('pointing picks the text clicked; the click never reaches the app; long or absent text is refused', async () => {
    html('<p id="t">Changes saved</p><div id="long">' + 'x '.repeat(50) + '</div>');
    const clicks = vi.fn();
    document.addEventListener('click', clicks);
    const { f, onFixed } = openWait();
    press('Fix this step');
    await tick();
    press('No, I’ll point at it');
    expect(msg()).toBe('Click the text this step should wait for. Esc to cancel.');
    document.getElementById('long')!.click();
    expect(f.state).toBe('point');
    expect(msg()).toMatch(/can’t wait for that/);
    document.getElementById('t')!.click();
    expect(clicks).not.toHaveBeenCalled();
    expect((onFixed.mock.calls[0][0] as Trace).steps[2].until).toEqual({ text: 'Changes saved' });
    document.removeEventListener('click', clicks);
  });

  it('Remove this wait drops the step, moves its caption on when the next has none, and carries on there', () => {
    html('<p>x</p>');
    const t: Trace = { ...WAIT, steps: [...WAIT.steps.slice(0, 3), { type: 'click', target: { text: 'Next' } }] };
    const { onFixed } = openWait({ trace: t });
    press('Remove this wait');
    const [fixed, from] = onFixed.mock.calls[0] as [Trace, number];
    expect(fixed.steps).toHaveLength(3);
    expect(fixed.steps[2]).toEqual({ type: 'click', target: { text: 'Next' }, say: 'Saving…' });
    expect(from).toBe(2);
    expect(msg()).toBe('Removed step 3 (the wait).');
    expect(buttons()).toEqual(['Save the guide', 'Just this time']);
  });

  it('a wait for something to go offers only Remove and Stop; a one-step guide can’t remove its only step', () => {
    html('<div class="spinner">…</div>');
    const t: Trace = { version: 1, steps: [{ type: 'click', target: { text: 'Go' } }, { type: 'wait', target: { sel: '.spinner' }, until: { gone: true } }] };
    open({ trace: t, index: 1, reason: 'until-timeout' });
    expect(msg()).toBe('Step 2 waited for .spinner to go, and it never did.');
    expect(buttons()).toEqual(['Remove this wait', 'Stop']);
    fixes.forEach((x) => x.close());
    open({ trace: { version: 1, steps: [{ type: 'wait', until: { text: 'Saved' } }] }, index: 0, reason: 'until-timeout' });
    expect(buttons()).toEqual(['Fix this step', 'Stop']);
  });

  it('a wait on a target looks only inside it', async () => {
    html('<div id="status">Status: running</div><p>Saved elsewhere</p>');
    const t: Trace = { version: 1, steps: [{ type: 'click', target: { text: 'Go' } }, { type: 'wait', target: { sel: '#status' }, until: { text: 'Started' } }] };
    const { f } = open({ trace: t, index: 1, reason: 'until-timeout', ai: async () => ({ id: 0 }) });
    press('Fix this step');
    await tick();
    expect(f.state).toBe('guess');
    expect(msg()).toBe('Is it “Status: running”?');
  });
});

describe('mount: Fix this step', () => {
  let mounted: GuidesController[] = [];
  const go = (record: Parameters<typeof mount>[0]['record'], fx = fakeFix(), p = fakePlayer()) => {
    const g = mount({ guides: MANIFEST, record, launcher: false, perform: true }, { player: p.load, fix: fx.load, studio: vi.fn() as never });
    mounted.push(g);
    return { g, fx, p };
  };
  const stall = (p: ReturnType<typeof fakePlayer>, index = 1, reason: 'not-found' | 'wait-timeout' | 'until-timeout' = 'not-found', k = p.made.length - 1) =>
    p.made[k].ctl.emit('stalled', { index, step: INLINE.steps[index], reason } as TraceEvents['stalled']);
  beforeEach(() => { history.replaceState({}, '', '/app'); sessionStorage.clear(); });
  afterEach(() => { mounted.forEach((g) => g.destroy()); mounted = []; });

  it('people who may not record see nothing, and the fix code never loads', async () => {
    for (const record of [undefined, { allowed: () => false }, { allowed: () => { throw new Error('x'); } }]) {
      const { g, fx, p } = go(record as never);
      await g.play('inline');
      stall(p);
      await tick();
      expect(fx.load).not.toHaveBeenCalled();
      expect(fx.made).toHaveLength(0);
    }
  });

  it('a step that can’t find its element, and a wait whose text never showed, are offered (not a wait-for-element timeout)', async () => {
    const { g, fx, p } = go({ allowed: () => true });
    await g.play('inline');
    stall(p, 1, 'wait-timeout');
    await tick();
    expect(fx.made).toHaveLength(0);
    stall(p, 1, 'not-found');
    await tick();
    expect(fx.made).toHaveLength(1);
    expect(fx.made[0].o.reason).toBe('not-found');
    // A second stall while the offer is open doesn't stack another card.
    stall(p, 1, 'not-found');
    await tick();
    expect(fx.made).toHaveLength(1);
  });

  it('an until-timeout passes its reason and the texts seen while waiting; a fix past the end ends the guide', async () => {
    const { g, fx, p } = go({ allowed: () => true });
    const ends = vi.fn();
    g.on('end', ends);
    await g.play('inline');
    p.made[0].ctl.emit('stalled', { index: 1, step: INLINE.steps[1], reason: 'until-timeout', seen: [{ text: 'Changes saved', element: document.body }] } as unknown as TraceEvents['stalled']);
    await tick();
    expect(fx.made[0].o).toMatchObject({ reason: 'until-timeout', seen: [{ text: 'Changes saved' }], index: 1 });
    fx.made[0].state = 'fixed';
    fx.made[0].o.onFixed(INLINE, 2);          // the wait was the last step, and it is met now
    await tick();
    expect(p.made).toHaveLength(1);           // nothing left to play
    expect(p.made[0].ctl.destroyed).toBe(true);
    expect(ends).toHaveBeenCalledOnce();
  });

  it('the author gets the guide as authored, the step, the entry, ai and save', async () => {
    const save = vi.fn();
    const ai = vi.fn();
    const { g, fx, p } = go({ allowed: async () => true, save, ai });
    await g.play('inline');
    stall(p);
    await tick();
    const o = fx.made[0].o;
    expect(o.trace).toEqual(INLINE);
    expect(o.index).toBe(1);
    expect(o.entry).toEqual({ id: 'inline', title: 'Inline', trace: INLINE, modes: ['overlay', 'perform'] });
    expect(o.save).toBe(save);
    expect(o.ai).toBe(ai);
    expect(o.doc).toBe(document);
  });

  it('a guide from a URL is fetched raw for the fix', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(INLINE), { status: 200 }));
    const { g, fx, p } = go({ allowed: () => true });
    await g.play('remote');
    stall(p);
    await tick(20);
    expect(fetchMock.mock.calls[0][0]).toBe(`${location.origin}/traces/remote.trace.json`);
    expect(fx.made[0].o.trace).toEqual(INLINE);
    expect(fx.made[0].o.entry).toMatchObject({ id: 'remote', trace: 'traces/remote.trace.json', tags: ['x'] });
  });

  it('a fix that can’t be offered is reported, not thrown', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 200 }));
    const { g, fx, p } = go({ allowed: () => true });
    const errs: Error[] = [];
    g.on('error', (e) => errs.push(e));
    await g.play('remote');
    stall(p);
    await tick(20);
    expect(fx.made).toHaveLength(0);
    expect(errs[0].message).toMatch(/could not offer a fix/);
  });

  it('fixed: the guide carries on from that step with the fixed trace (no stop), in its mode; later plays use it too', async () => {
    const { g, fx, p } = go({ allowed: () => true });
    const stops = vi.fn();
    g.on('stop', stops);
    await g.play('inline', { mode: 'perform' });
    stall(p);
    await tick();
    const fixed: Trace = JSON.parse(JSON.stringify(INLINE));
    fixed.steps[1].target = { role: 'button', name: 'Store' };
    fx.made[0].state = 'fixed';
    fx.made[0].o.onFixed(fixed, 1);
    await tick();
    expect(p.made).toHaveLength(2);
    expect(p.made[0].ctl.destroyed).toBe(true);
    expect(p.made[1].opts).toMatchObject({ trace: fixed, startAt: 1, mode: 'perform' });
    expect(stops).not.toHaveBeenCalled();
    expect(fx.made[0].closed).toBe(0); // the card stays, to save
    g.stop();
    expect(fx.made[0].closed).toBe(0);
    await g.play('inline');
    expect(p.made[2].opts.trace).toBe(fixed);
    expect(p.made[2].opts.startAt).toBeUndefined();
    // Stalling again on the fixed guide offers the fixed trace, and the old card makes way.
    stall(p, 1);
    await tick();
    expect(fx.made[0].closed).toBe(1);
    expect(fx.made[1].o.trace).toBe(fixed);
  });

  it('an unanswered offer goes when the guide stops; Stop on the card stops the guide', async () => {
    const { g, fx, p } = go({ allowed: () => true });
    await g.play('inline');
    stall(p);
    await tick();
    g.stop();
    expect(fx.made[0].closed).toBe(1);

    const stops = vi.fn();
    g.on('stop', stops);
    await g.play('inline');
    stall(p);
    await tick();
    fx.made[1].state = 'closed';
    fx.made[1].o.onStop();
    expect(p.made[p.made.length - 1].ctl.destroyed).toBe(true);
    expect(stops).toHaveBeenCalledOnce();
  });

  it('a cancelled fix changes nothing: the next play is the guide as it was', async () => {
    const { g, fx, p } = go({ allowed: () => true });
    await g.play('inline');
    stall(p);
    await tick();
    fx.made[0].state = 'closed';
    g.stop();
    await g.play('inline');
    expect(p.made[p.made.length - 1].opts.trace).toEqual(INLINE);
    expect(p.made[p.made.length - 1].opts.startAt).toBeUndefined();
  });

  it('a stall from a guide already replaced is ignored', async () => {
    const { g, fx, p } = go({ allowed: () => true });
    await g.play('inline');
    await g.play('remote').catch(() => null);
    stall(p, 1, 'not-found', 0);
    await tick();
    expect(fx.made).toHaveLength(0);
  });
});

describe('the npm entry', () => {
  it('loads the fix with import()', async () => {
    const mod = await defaultLoaders.fix!();
    expect(typeof mod.offerFix).toBe('function');
  });
});
