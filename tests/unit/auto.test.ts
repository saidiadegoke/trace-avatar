// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_KEY, END_HOLD_MS, GuideError, defaultLoaders, mount } from '../../src/auto/index';
import type { GuidesController, Manifest, MountOptions, PlayerModule } from '../../src/auto/index';
import { createEmitter } from '../../src/shell/emitter';
import type { TraceController, TraceEvents, TraceOptions } from '../../src/index';

/** A player that records how it was created and lets the test drive it. */
function fakePlayer(o: { state?: string; fail?: boolean; ready?: Promise<void> } = {}) {
  const made: Array<{ opts: TraceOptions; ctl: TraceController & { emit: <K extends keyof TraceEvents>(k: K, d: TraceEvents[K]) => void; destroyed: boolean; plays: number } }> = [];
  const mod: PlayerModule = {
    createTrace(opts) {
      if (o.fail) throw new Error('bad trace');
      const em = createEmitter<TraceEvents>();
      const ctl = {
        ready: o.ready ?? Promise.resolve(),
        state: o.state ?? 'playing',
        destroyed: false,
        plays: 0,
        play() { ctl.plays += 1; },
        destroy() { ctl.destroyed = true; },
        on: em.on,
        emit: em.emit,
      } as unknown as (typeof made)[number]['ctl'];
      made.push({ opts, ctl });
      return ctl;
    },
  };
  return { mod, made, load: vi.fn(async () => mod) };
}

const MANIFEST: Manifest = {
  version: 1,
  guides: [
    { id: 'invoice', title: 'Create an invoice', trace: 'traces/invoice.trace.json', modes: ['overlay', 'perform'], pages: ['/app'] },
    { id: 'inline', title: 'Inline', trace: { version: 1, steps: [{ type: 'note', say: 'hi' }] } },
  ],
};

let mounted: GuidesController[] = [];
const go = (o: Partial<MountOptions> = {}, p = fakePlayer()) => {
  const g = mount({ guides: MANIFEST, ...o }, { player: p.load });
  mounted.push(g);
  return { g, p };
};
const tick = async (n = 6) => { for (let k = 0; k < n; k += 1) await Promise.resolve(); };

beforeEach(() => { history.replaceState({}, '', '/app'); sessionStorage.clear(); });
afterEach(() => { mounted.forEach((g) => g.destroy()); mounted = []; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

describe('mount: the manifest', () => {
  it('loads an object, lists by page, and knows the modes', async () => {
    const { g } = go({ perform: true });
    const ready = vi.fn();
    g.on('ready', ready);
    await g.ready;
    expect(g.manifest?.guides.map((x) => x.id)).toEqual(['invoice', 'inline']);
    expect(g.list().map((x) => x.id)).toEqual(['invoice', 'inline']);
    expect(g.list('/settings').map((x) => x.id)).toEqual(['inline']);
    expect(g.modes('invoice')).toEqual(['overlay', 'perform']);
    expect(g.modes('nope')).toEqual([]);
  });

  it('fetches a URL; trace URLs resolve against the manifest', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(MANIFEST), { status: 200 }));
    const { g, p } = go({ guides: '/guides/index.json' });
    await g.ready;
    expect(fetchMock.mock.calls[0][0]).toBe(`${location.origin}/guides/index.json`);
    await g.play('invoice');
    expect(p.made[0].opts.trace).toBe(`${location.origin}/guides/traces/invoice.trace.json`);
    await g.play('inline');
    expect(p.made[1].opts.trace).toEqual(MANIFEST.guides[1].trace);
  });

  it('a manifest that fails to load or is invalid is reported (to listeners, else the console)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    const { g } = go({ guides: '/missing.json' });
    const errs: Error[] = [];
    g.on('error', (e) => errs.push(e));
    await expect(g.ready).rejects.toThrow('HTTP 404');
    await tick();
    expect(errs[0]).toBeInstanceOf(GuideError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = go({ guides: { version: 1, guides: [{ id: '' }] } as unknown as Manifest }).g;
    await expect(bad.ready).rejects.toThrow(/invalid guides: guides\[0\]\.id/);
    await tick();
    expect(warn.mock.calls[0][0]).toMatch(/^\[trace-avatar\] invalid guides/);
    expect(await bad.play('x')).toBeNull();
  });
});

describe('mount: playing', () => {
  it('plays by id with the host’s hooks, marks it active, and shows Stop in the launcher', async () => {
    const navigate = vi.fn();
    const prepare = vi.fn(() => true);
    const { g, p } = go({ navigate, prepare, onReset: vi.fn(), currentPath: () => '/app', rate: 2, captions: 'bar', avatar: { name: 'Ada' }, controls: false });
    const played = vi.fn();
    g.on('play', played);
    const c = await g.play('invoice');
    expect(c).toBe(p.made[0].ctl);
    expect(p.made[0].opts).toMatchObject({ mode: 'overlay', controls: false, autoplay: true, resumeKey: 'auto:invoice', rate: 2, captions: 'bar', avatar: { name: 'Ada' }, navigate, prepare });
    expect(played.mock.calls[0][0]).toMatchObject({ id: 'invoice', mode: 'overlay' });
    expect(g.playing?.id).toBe('invoice');
    expect(JSON.parse(sessionStorage.getItem(ACTIVE_KEY)!)).toMatchObject({ id: 'invoice', mode: 'overlay' });
    expect(g.launcher!.host.shadowRoot!.querySelector('.fab')!.textContent).toBe('■ Stop guide');
    expect(p.load).toHaveBeenCalledTimes(1);
  });

  it('the player is loaded once, on the first play only', async () => {
    const { g, p } = go();
    await g.ready;
    expect(p.load).not.toHaveBeenCalled();
    await g.play('inline');
    await g.play('inline');
    expect(p.load).toHaveBeenCalledTimes(1);
  });

  it('a player that fails to load is reported and tried again next time', async () => {
    const p = fakePlayer();
    p.load.mockRejectedValueOnce(new Error('offline'));
    const { g } = go({}, p);
    const errs: string[] = [];
    g.on('error', (e) => errs.push(e.message));
    expect(await g.play('inline')).toBeNull();
    expect(errs).toEqual(['could not load the player: offline']);
    expect(await g.play('inline')).not.toBeNull();
  });

  it('Do it for me needs both the manifest and perform: true; unknown ids and bad traces are errors', async () => {
    const off = go();
    const errs: string[] = [];
    off.g.on('error', (e) => errs.push(e.message));
    expect(await off.g.play('invoice', { mode: 'perform' })).toBeNull();
    expect(await off.g.play('inline', { mode: 'perform' })).toBeNull();
    expect(await off.g.play('nope')).toBeNull();
    expect(errs).toEqual([
      '"invoice" can\'t be played as Do it for me here (the manifest and mount({ perform: true }) must both allow it)',
      '"inline" can\'t be played as Do it for me here (the manifest and mount({ perform: true }) must both allow it)',
      'no guide "nope" in the manifest',
    ]);
    const on = go({ perform: true });
    await on.g.play('invoice', { mode: 'perform' });
    expect(on.p.made[0].opts.mode).toBe('perform');
    sessionStorage.clear(); // or the next mount carries on with that guide (see below)
    const broken = go({}, fakePlayer({ fail: true }));
    const e2: string[] = [];
    broken.g.on('error', (e) => e2.push(e.message));
    expect(await broken.g.play('inline')).toBeNull();
    expect(e2).toEqual(['"inline" could not start: bad trace']);
    sessionStorage.clear();
    const only = go({ guides: { version: 1, guides: [{ id: 'p', title: 'P', trace: 'p.json', modes: ['perform'] }] } });
    const e3: string[] = [];
    only.g.on('error', (e) => e3.push(e.message));
    expect(await only.g.play('p')).toBeNull();
    expect(e3).toEqual(['"p" has no mode that can play here']);
  });

  it('player errors are passed on with the guide id', async () => {
    const { g, p } = go();
    const errs: GuideError[] = [];
    g.on('error', (e) => errs.push(e as GuideError));
    await g.play('inline');
    p.made[0].ctl.emit('error', new Error('step 2 failed') as never);
    expect(errs[0]).toMatchObject({ message: 'step 2 failed', id: 'inline' });
  });

  it('a trace that fails to load drops the guide', async () => {
    const failing = Promise.reject(new Error('404'));
    failing.catch(() => {});
    const { g } = go({}, fakePlayer({ ready: failing }));
    expect(await g.play('inline')).toBeNull();
    expect(g.playing).toBeNull();
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it('playing another guide stops the first', async () => {
    const { g, p } = go();
    const stops: unknown[] = [];
    g.on('stop', (e) => stops.push(e));
    await g.play('invoice');
    await g.play('inline');
    expect(p.made[0].ctl.destroyed).toBe(true);
    expect(stops).toEqual([{ id: 'invoice', mode: 'overlay' }]);
    expect(g.playing?.id).toBe('inline');
  });

  it('at the end the last step stays a moment, then the guide is cleared and the launcher is back', async () => {
    vi.useFakeTimers();
    const { g, p } = go();
    const ends: unknown[] = [];
    g.on('end', (e) => ends.push(e));
    await g.play('inline');
    p.made[0].ctl.emit('end', undefined);
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBeNull();
    expect(g.playing).not.toBeNull();
    vi.advanceTimersByTime(END_HOLD_MS);
    expect(g.playing).toBeNull();
    expect(p.made[0].ctl.destroyed).toBe(true);
    expect(ends).toEqual([{ id: 'inline', mode: 'overlay' }]);
    expect(g.launcher!.host.shadowRoot!.querySelector('.fab')!.textContent).toBe('?');
  });

  it('an end from a guide already replaced does nothing', async () => {
    const { g, p } = go();
    await g.play('inline');
    await g.play('invoice');
    p.made[0].ctl.emit('end', undefined);
    expect(g.playing?.id).toBe('invoice');
  });

  it('stop (and the launcher’s Stop) clears it', async () => {
    const { g, p } = go();
    const stops: unknown[] = [];
    g.on('stop', (e) => stops.push(e));
    await g.play('inline');
    (g.launcher!.host.shadowRoot!.querySelector('.fab') as HTMLElement).click();
    expect(p.made[0].ctl.destroyed).toBe(true);
    expect(stops).toHaveLength(1);
    g.stop(); // nothing playing: nothing to report
    expect(stops).toHaveLength(1);
  });

  it('the launcher plays what it lists', async () => {
    const { g, p } = go({ perform: true });
    await g.ready;
    g.launcher!.open();
    const root = g.launcher!.host.shadowRoot!;
    expect(Array.from(root.querySelectorAll('.menu button')).map((b) => b.textContent)).toEqual(['Show me', 'Do it for me', 'Show me']);
    (root.querySelectorAll('.menu button')[1] as HTMLElement).click();
    await tick();
    expect(p.made[0].opts).toMatchObject({ mode: 'perform' });
  });

  it('launcher: false hides the corner button', async () => {
    const { g } = go({ launcher: false });
    expect(g.launcher!.host.shadowRoot!.querySelector('div')!.className).toBe('r hide');
  });
});

describe('mount: data-trace-guide buttons', () => {
  it('any element (added later too) plays its guide, in its mode; other clicks are left alone', async () => {
    const { g, p } = go({ perform: true });
    await g.ready;
    document.body.insertAdjacentHTML('beforeend', '<a href="/x" id="a" data-trace-guide="invoice"><span id="s">Show me</span></a><button id="b" data-trace-guide="invoice" data-trace-mode="perform">Do</button><button id="c" data-trace-guide="invoice" data-trace-mode="weird">?</button><button id="n">none</button>');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('s')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await tick();
    document.getElementById('b')!.click();
    await tick();
    document.getElementById('c')!.click();
    await tick();
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('n')!.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(p.made.map((m) => m.opts.mode)).toEqual(['overlay', 'perform', 'overlay']);
  });

  it('after destroy, buttons do nothing and the launcher is gone', async () => {
    const { g, p } = go();
    await g.play('inline');
    g.destroy();
    g.destroy();
    expect(p.made[0].ctl.destroyed).toBe(true);
    document.body.insertAdjacentHTML('beforeend', '<button id="b" data-trace-guide="inline">x</button>');
    document.getElementById('b')!.click();
    await tick();
    expect(p.made).toHaveLength(1);
    expect(await g.play('inline')).toBeNull();
    expect(document.querySelector('[data-trace-avatar]')).toBeNull();
  });
});

describe('mount: carrying on after a full page load', () => {
  it('a guide active on the last page is recreated here and plays on, when the player found its place', async () => {
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'invoice', mode: 'overlay', at: Date.now() }));
    const p = fakePlayer({ state: 'paused' });
    const { g } = go({}, p);
    await g.ready;
    await tick(10);
    expect(p.made[0].opts).toMatchObject({ autoplay: false, resumeKey: 'auto:invoice' });
    expect(p.made[0].ctl.plays).toBe(1);
    expect(g.playing?.id).toBe('invoice');
  });

  it('…and is dropped when the player did not resume (it would start over), or when it is stale or broken', async () => {
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'invoice', mode: 'overlay', at: Date.now() }));
    const p = fakePlayer({ state: 'idle' });
    const { g } = go({}, p);
    await g.ready;
    await tick(10);
    expect(p.made[0].ctl.destroyed).toBe(true);
    expect(g.playing).toBeNull();
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBeNull();

    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'invoice', mode: 'overlay', at: Date.now() - 11 * 60_000 }));
    const stale = go();
    await stale.g.ready;
    await tick(10);
    expect(stale.p.made).toHaveLength(0);
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBeNull();

    sessionStorage.setItem(ACTIVE_KEY, '{nope');
    const junk = go();
    await tick(10);
    expect(junk.p.made).toHaveLength(0);
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 1 }));
    const wrong = go();
    await tick(10);
    expect(wrong.p.made).toHaveLength(0);
  });

  it('a guide carried on in a mode no longer allowed here is reported, not played', async () => {
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'invoice', mode: 'perform', at: Date.now() }));
    const errs: string[] = [];
    const { g, p } = go();
    g.on('error', (e) => errs.push(e.message));
    await g.ready;
    await tick(10);
    expect(p.made).toHaveLength(0);
    expect(errs[0]).toMatch(/can't be played as Do it for me here/);
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it('storage that throws only means no carrying on', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('off'); });
    const { g } = go();
    expect(await g.play('inline')).not.toBeNull();
    g.stop();
  });
});

describe('defaultLoaders', () => {
  it('loads the perform build, which plays both modes', async () => {
    const mod = await defaultLoaders.player();
    expect(typeof mod.createTrace).toBe('function');
    expect(typeof (mod as unknown as { createPerformer: unknown }).createPerformer).toBe('function');
  });
});
