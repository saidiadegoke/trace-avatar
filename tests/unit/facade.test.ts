// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceError, createTrace } from '../../src/index';
import type { ClockPort, InputPort, TraceOptions } from '../../src/index';
import type { Trace } from '../../src/core/format';
import { html, setRect } from './dom-helpers';

/** A manual clock: frames run only when the test says so. */
function manualClock() {
  let now = 0;
  let id = 0;
  const queue = new Map<number, () => void>();
  const port: ClockPort = {
    now: () => now,
    raf: (cb) => { id += 1; queue.set(id, cb); return id; },
    caf: (k) => { queue.delete(k); },
  };
  return {
    port,
    pending: () => queue.size,
    /** Advance wall time by dt and run one frame. */
    frame(dt = 16) {
      now += dt;
      const cbs = Array.from(queue.values());
      queue.clear();
      cbs.forEach((cb) => cb());
    },
    run(ms: number, dt = 16) { for (let t = 0; t < ms; t += dt) this.frame(dt); },
  };
}

function manualInput() {
  let cb: ((e: PointerEvent | KeyboardEvent) => void) | null = null;
  const port: InputPort = { watch: (fn) => { cb = fn; return () => { cb = null; }; } };
  return {
    port,
    get active() { return !!cb; },
    key(key: string, target: EventTarget = document.body) {
      const e = { type: 'keydown', key, target, preventDefault: vi.fn() } as unknown as KeyboardEvent;
      cb?.(e);
      return e;
    },
    pointer() { cb?.({ type: 'pointerdown', target: document.body } as unknown as PointerEvent); },
  };
}

const TRACE: Trace = {
  version: 1,
  avatar: { name: 'Ada' },
  steps: [
    { type: 'click', target: { sel: '#a' }, t: 500, say: 'Open it' },
    { type: 'click', target: { sel: '#b' }, t: 1500 },
  ],
};

let clock: ReturnType<typeof manualClock>;
let input: ReturnType<typeof manualInput>;
const make = (o: Partial<TraceOptions> = {}) => createTrace({ trace: TRACE, reducedMotion: false, ...o, ports: { clock: clock.port, input: input.port, ...o.ports } });

beforeEach(() => {
  clock = manualClock();
  input = manualInput();
  html('<button id="a">A</button><button id="b">B</button><div id="box" style="overflow:auto"></div>');
  setRect(document.getElementById('a')!, 100, 100);
  setRect(document.getElementById('b')!, 500, 300);
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('createTrace', () => {
  it('throws a TraceError at once for an invalid trace object', () => {
    expect(() => make({ trace: { version: 1, steps: [] } as unknown as Trace })).toThrow(TraceError);
    try { make({ trace: { version: 1, steps: [{ type: 'click' }] } as unknown as Trace }); } catch (e) {
      expect((e as TraceError).errors[0].path).toBe('steps[0].target');
      expect((e as Error).message).toMatch(/steps\[0\]\.target a click step needs a target/);
    }
  });

  it('starts idle with the overlay mounted and the cursor hidden', async () => {
    const t = make();
    await t.ready;
    expect(t.state).toBe('idle');
    expect(t.duration).toBe(t.trace!.duration);
    const host = document.querySelector('[data-trace-avatar]')!;
    expect(host.shadowRoot!.querySelector('.cur')!.className).not.toContain('on');
  });

  it('plays through: emits state, step and end events, then stops asking for frames', () => {
    const t = make();
    const states: string[] = [];
    const steps: number[] = [];
    let ended = 0;
    t.on('state', (e) => states.push(e.phase));
    t.on('step', (e) => { steps.push(e.index); expect(e.element).toBe(document.getElementById(e.index ? 'b' : 'a')); expect(e.resolvedBy).toBe('sel'); });
    t.on('end', () => { ended += 1; });
    t.play();
    clock.run(5000);
    expect(steps).toEqual([0, 1]);
    expect(ended).toBe(1);
    expect(states).toEqual(['playing', 'ended']);
    expect(t.state).toBe('ended');
    expect(clock.pending()).toBe(0);
  });

  it('autoplay starts on creation', () => {
    const t = make({ autoplay: true });
    expect(t.state).toBe('playing');
  });

  it('pause, seek, next, prev, setRate, toggle and stop drive the player', () => {
    const t = make();
    t.play();
    clock.run(200);
    t.pause();
    expect(t.state).toBe('paused');
    const at = t.time;
    clock.run(500);
    expect(t.time).toBe(at);
    t.seek(1000);
    expect(t.time).toBe(1000);
    expect(t.index).toBe(1);
    t.prev();
    expect(t.index).toBe(0);
    t.next();
    expect(t.index).toBe(1);
    t.setRate(2);
    t.toggle();
    expect(t.state).toBe('playing');
    clock.frame(16);
    clock.frame(16);
    expect(t.time).toBe(t.trace!.end[0] + 32);
    t.stop();
    expect(t.state).toBe('idle');
    expect(clock.pending()).toBe(0);
  });

  it('a seed option overrides the trace seed', () => {
    expect(make({ seed: 77 }).trace!.seed).toBe(77);
  });

  it('reveals off-screen elements and runs scroll steps on the window or a scrollable element', () => {
    setRect(document.getElementById('b')!, 500, 5000);
    const into = vi.fn();
    (document.getElementById('b') as HTMLElement).scrollIntoView = into;
    const t = make();
    t.play();
    clock.run(5000);
    expect(into).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' });

    const winScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const t2 = make({ trace: { version: 1, steps: [{ type: 'scroll', by: { y: 300 } }] } });
    t2.play();
    clock.run(3000);
    expect(winScroll).toHaveBeenCalledWith({ left: 0, top: 300, behavior: 'smooth' });

    const box = document.getElementById('box')!;
    Object.defineProperty(box, 'scrollHeight', { value: 900 });
    Object.defineProperty(box, 'clientHeight', { value: 100 });
    setRect(box, 0, 0, 200, 100);
    box.scrollTo = vi.fn() as never;
    const t3 = make({ trace: { version: 1, steps: [{ type: 'scroll', target: { sel: '#box' }, to: { y: 50 } }] }, reducedMotion: true });
    t3.play();
    clock.run(3000);
    expect(box.scrollTo).toHaveBeenCalledWith({ left: undefined, top: 50, behavior: 'auto' });
  });

  describe('scroll: whether steps may move the page', () => {
    const offscreen = () => {
      setRect(document.getElementById('b')!, 500, 5000);
      const into = vi.fn();
      (document.getElementById('b') as HTMLElement).scrollIntoView = into;
      return into;
    };
    const wheel = (target: EventTarget = document.body) => target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 300 }));

    it("'never' leaves the page where it is; authored scroll steps still scroll", () => {
      const into = offscreen();
      const t = make({ scroll: 'never' });
      t.play();
      clock.run(5000);
      expect(t.state).toBe('ended');
      expect(into).not.toHaveBeenCalled();
      const winScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
      make({ scroll: 'never', trace: { version: 1, steps: [{ type: 'scroll', by: { y: 300 } }] } }).play();
      clock.run(3000);
      expect(winScroll).toHaveBeenCalled();
    });

    it("'auto' (the default) stops bringing elements into view once the viewer scrolls, until they steer the guide again", () => {
      const into = offscreen();
      const t = make();
      t.play();
      clock.run(200);
      wheel();
      clock.run(5000);
      expect(t.state).toBe('ended');
      expect(into).not.toHaveBeenCalled();        // the viewer scrolled away: not pulled back
      t.play();                                    // they steer it again
      clock.run(5000);
      expect(into).toHaveBeenCalledTimes(1);
      t.destroy();
      // Without scrolling, 'auto' reveals just as before.
      const into2 = offscreen();
      make().play();
      clock.run(5000);
      expect(into2).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    });

    it("'always' reveals even after the viewer scrolled; a wheel over the guide's own controls doesn't count", () => {
      const into = offscreen();
      const t = make({ scroll: 'always' });
      t.play();
      clock.run(200);
      wheel();
      clock.run(5000);
      expect(into).toHaveBeenCalledTimes(1);
      t.destroy();
      const into2 = offscreen();
      const t2 = make({ controls: true });
      t2.play();
      clock.run(200);
      const hosts = document.querySelectorAll('[data-trace-avatar]'); const host = hosts[hosts.length - 1]!;
      wheel(host);
      clock.run(5000);
      expect(into2).toHaveBeenCalledTimes(1);
    });

    it('stops listening when destroyed', () => {
      const remove = vi.spyOn(document, 'removeEventListener');
      make().destroy();
      expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['wheel', 'touchmove']));
    });
  });

  it('ripples on clicks, except under reduced motion', () => {
    const t = make();
    t.play();
    clock.run(800);
    const host = document.querySelectorAll('[data-trace-avatar]')[0]!;
    expect(host.shadowRoot!.querySelector('.rip.a')).not.toBeNull();
    t.destroy();
    const t2 = make({ reducedMotion: true });
    t2.play();
    clock.run(800);
    const host2 = document.querySelector('[data-trace-avatar]')!;
    expect(host2.shadowRoot!.querySelector('.rip.a, .rip.b')).toBeNull();
  });

  it('emits stalled when an element never appears', () => {
    const t = make({ trace: { version: 1, steps: [{ type: 'click', target: { sel: '#nope' }, t: 100, timeout: 200 }] } });
    const stalled = vi.fn();
    t.on('stalled', stalled);
    t.play();
    clock.run(600);
    expect(stalled).toHaveBeenCalledWith(expect.objectContaining({ index: 0, reason: 'not-found' }));
  });

  it('viewer input pauses (takeover), unless takeover is ignore', () => {
    const t = make();
    t.play();
    clock.run(100);
    input.pointer();
    expect(t.state).toBe('paused');
    const t2 = make({ takeover: 'ignore' });
    t2.play();
    input.pointer();
    expect(t2.state).toBe('playing');
  });

  it('keyboard shortcuts work outside fields when enabled', () => {
    const t = make({ keyboard: true, takeover: 'ignore' });
    t.play();
    const e = input.key(' ');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(t.state).toBe('paused');
    input.key('k');
    expect(t.state).toBe('playing');
    input.key('ArrowRight');
    expect(t.index).toBe(1);
    input.key('ArrowLeft');
    expect(t.index).toBe(0);
    const field = document.createElement('input');
    input.key(' ', field);
    expect(t.state).toBe('playing');
  });

  it('keyboard is off by default: a key is a takeover', () => {
    const t = make();
    t.play();
    input.key(' ');
    expect(t.state).toBe('paused');
  });

  it('control buttons drive the trace (restart and rate cycle)', () => {
    const t = make({ controls: true });
    const btn = (label: string) => document.querySelector('[data-trace-avatar]')!.shadowRoot!.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    btn('Play').click();
    expect(t.state).toBe('playing');
    clock.run(300);
    btn('Restart').click();
    expect(t.time).toBe(0);
    expect(t.state).toBe('playing');
    btn('Playback speed').click();
    clock.frame(); clock.frame(10);
    expect(t.time).toBe(15);
    btn('Next step').click();
    expect(t.index).toBe(1);
    btn('Previous step').click();
    expect(t.index).toBe(0);
  });

  it('destroy removes the overlay, stops frames and input, and warns once on later calls', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = make();
    t.play();
    t.destroy();
    t.destroy();
    expect(document.querySelector('[data-trace-avatar]')).toBeNull();
    expect(clock.pending()).toBe(0);
    expect(input.active).toBe(false);
    t.play();
    t.next();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  describe('loading from a URL', () => {
    it('fetches, parses, and replays commands sent before it loaded', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(TRACE), { status: 200 }));
      const t = make({ trace: '/demo.trace.json' });
      t.play();
      expect(t.trace).toBeNull();
      await t.ready;
      expect(fetchMock).toHaveBeenCalledWith('/demo.trace.json');
      expect(t.state).toBe('playing');
    });

    it('rejects ready and emits error on HTTP failure or an invalid trace', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('x', { status: 404 }));
      const t = make({ trace: '/missing.json' });
      const err = vi.fn();
      t.on('error', err);
      await expect(t.ready).rejects.toThrow(/HTTP 404/);
      expect(err).toHaveBeenCalled();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, steps: [] }), { status: 200 }));
      await expect(make({ trace: '/bad.json' }).ready).rejects.toBeInstanceOf(TraceError);

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
      await expect(make({ trace: '/x.json' }).ready).rejects.toThrow(/Could not load trace: offline/);
    });

    it('does not set up after being destroyed while loading', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(TRACE), { status: 200 }));
      const t = make({ trace: '/demo.trace.json' });
      t.destroy();
      await t.ready;
      expect(document.querySelector('[data-trace-avatar]')).toBeNull();
    });
  });

  it('uses the real browser clock and page when no ports are given', () => {
    const t = createTrace({ trace: TRACE });
    t.play();
    expect(t.state).toBe('playing');
    t.destroy();
  });
});

describe('pages', () => {
  const PAGED: Trace = { version: 1, steps: [
    { type: 'click', target: { sel: '#a' }, t: 300, page: '/start' },
    { type: 'click', target: { sel: '#b' }, t: 900, page: '/tasks/*' },
  ] };

  it('tells the host and navigates to a page it can name, then plays on', async () => {
    let path = '/elsewhere';
    const navigate = vi.fn((p: string) => { path = p; });
    const page = vi.fn();
    const t = make({ trace: PAGED, navigate, currentPath: () => path });
    await t.ready;
    t.on('page', page);
    t.play();
    clock.frame();
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ index: 0, want: '/start', at: '/elsewhere' }));
    expect(navigate).toHaveBeenCalledWith('/start');
    clock.run(800);
    expect(t.index).toBe(1);
    expect(t.state).toBe('waiting');
    // "/tasks/*" names no single address: the host hears about it, but nothing navigates.
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1, want: '/tasks/*', at: '/start' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    path = '/tasks/42';
    clock.run(2000);
    expect(t.state).toBe('ended');
  });

  it('without navigate, it waits with a caption; a failing navigate is reported', async () => {
    const t = make({ trace: PAGED, currentPath: () => '/elsewhere' });
    await t.ready;
    t.play();
    clock.run(5000);
    expect(t.state).toBe('waiting');
    const host = document.querySelector('[data-trace-avatar]')!;
    expect(host.shadowRoot!.textContent).toContain('Open /start to continue');
    t.destroy();

    const errors = vi.fn();
    const u = make({ trace: PAGED, currentPath: () => '/elsewhere', navigate: () => { throw new Error('no router'); } });
    await u.ready;
    u.on('error', errors);
    u.play();
    clock.frame();
    expect(errors.mock.calls[0][0].message).toMatch(/navigate\(\/start\) failed: no router/);
  });

  it('reads location.pathname by default, and treats a throwing currentPath as unknown', async () => {
    history.pushState({}, '', '/start');
    const t = make({ trace: PAGED });
    await t.ready;
    t.play();
    clock.run(1500);
    expect([t.index, t.state]).toEqual([1, 'waiting']); // played step 0 on /start, now wants /tasks/*
    t.destroy();
    const u = make({ trace: PAGED, currentPath: () => { throw new Error('x'); } });
    await u.ready;
    u.play();
    clock.run(2000);
    expect(u.state).toBe('ended');
  });
});

describe('perform mode, prepare, reset, resume, until (0.1.2)', () => {
  const fakeHands = () => {
    const calls: unknown[][] = [];
    const field = document.createElement('input');
    const performer = vi.fn(() => ({
      click: (el: Element, x?: number, y?: number, dbl?: boolean) => { calls.push(['click', el.id, x, y, !!dbl]); },
      hover: (el: Element) => { calls.push(['hover', el.id]); },
      key: (el: Element | null, combo: string) => { calls.push(['key', el?.id ?? null, combo]); },
      startTyping: (el: Element) => { calls.push(['start', el.id]); return field; },
      typeTo: (_f: Element, text: string, from: number, to: number) => { calls.push(['type', text.slice(from, to)]); },
      finishTyping: () => { calls.push(['finish']); },
      focus: (el: Element) => { calls.push(['focus', el.id]); },
    }));
    return { calls, performer };
  };

  it("mode: 'perform' needs a performer", () => {
    expect(() => make({ mode: 'perform' })).toThrow(/trace-avatar\/perform/);
  });

  it('acts out each step through the performer, typing as the chip does, then change', async () => {
    const { calls, performer } = fakeHands();
    const tr: Trace = { version: 1, steps: [
      { type: 'click', target: { sel: '#a' }, t: 300 },
      { type: 'type', target: { sel: '#b' }, text: 'Ada', t: 900 },
      { type: 'key', keys: 'Mod+Enter' },
      { type: 'hover', target: { sel: '#a' } },
      { type: 'dblclick', target: { sel: '#b' } },
    ] };
    const t = make({ trace: tr, mode: 'perform', performer, reducedMotion: true });
    await t.ready;
    t.play();
    clock.run(6000);
    expect(performer).toHaveBeenCalledWith(document);
    expect(calls.filter((c) => c[0] === 'type').map((c) => c[1]).join('')).toBe('Ada');
    expect(calls.filter((c) => c[0] === 'type').length).toBeGreaterThan(1); // progressively
    expect(calls.filter((c) => c[0] !== 'type')).toEqual([
      ['click', 'a', 150, 120, false], ['start', 'b'], ['finish'], ['key', null, 'Mod+Enter'], ['hover', 'a'], ['click', 'b', 550, 320, true],
    ]);
    expect(t.state).toBe('ended');
  });

  it('a performer failure is reported as an error and the guide goes on', async () => {
    const performer = () => ({
      click: () => { throw new Error('boom'); }, hover() {}, key() {}, focus() {},
      startTyping: (el: Element) => el, typeTo: () => { throw new Error('no typing'); }, finishTyping() {},
    });
    const errors: string[] = [];
    const tr: Trace = { version: 1, steps: [{ type: 'click', target: { sel: '#a' }, t: 100 }, { type: 'type', target: { sel: '#b' }, text: 'x', t: 600 }, { type: 'click', target: { sel: '#gone' }, timeout: 50 }] };
    const t = make({ trace: tr, mode: 'perform', performer });
    await t.ready;
    t.on('error', (e) => errors.push(e.message));
    t.play();
    clock.run(4000);
    expect(errors).toEqual(['perform step 0 (click) failed: boom', 'perform step 1 (type) failed: no typing']);
    expect(t.state).toBe('ended');
  });

  it('a masked field is handed to the viewer: focus, handoff event, then play goes on', async () => {
    const { calls, performer } = fakeHands();
    const tr: Trace = { version: 1, steps: [{ type: 'type', target: { sel: '#a' }, text: '•••', mask: true, t: 300 }, { type: 'click', target: { sel: '#b' } }] };
    const t = make({ trace: tr, mode: 'perform', performer });
    await t.ready;
    const handoff = vi.fn();
    t.on('handoff', handoff);
    t.play();
    clock.run(1500);
    expect(t.state).toBe('paused');
    expect(handoff).toHaveBeenCalledWith(expect.objectContaining({ index: 0, element: document.getElementById('a') }));
    expect(calls).toEqual([['focus', 'a']]);
    t.play();
    clock.run(2000);
    expect(calls).toContainEqual(['click', 'b', 550, 320, false]);
  });

  it('prepare gates every start: true plays, false / {ok:false} / throwing blocks with a caption; play retries', async () => {
    const answers: unknown[] = [false, { ok: false, say: 'Open the sandbox first.' }, 'throw', { ok: true }];
    const prepare = vi.fn(async (requires: string[]) => {
      const a = answers.shift();
      if (a === 'throw') throw new Error('no session');
      expect(requires).toEqual(['signed-in']);
      return a as boolean;
    });
    const t = make({ trace: { ...TRACE, meta: { requires: ['signed-in'] } }, prepare });
    await t.ready;
    const blocked = vi.fn();
    t.on('blocked', blocked);
    const caption = () => document.querySelector('[data-trace-avatar]')!.shadowRoot!.textContent;
    t.play();
    t.play(); // a second press while prepare runs is ignored
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(1));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(blocked.mock.calls[0][0]).toEqual({ requires: ['signed-in'], say: 'Sign in to start this guide.' });
    expect(caption()).toContain('Sign in to start this guide.');
    expect(t.state).toBe('idle');
    t.play();
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(2));
    expect(blocked.mock.calls[1][0].say).toBe('Open the sandbox first.');
    t.play();
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(3));
    expect(blocked.mock.calls[2][0].error).toBeInstanceOf(Error);
    t.play();
    await vi.waitFor(() => expect(t.state).toBe('playing'));
    clock.frame();
    expect(caption()).not.toContain('Sign in');
  });

  it('without signed-in in requires, the default message is neutral; destroying while preparing is safe', async () => {
    let release: (v: boolean) => void = () => {};
    const t = make({ trace: TRACE, prepare: () => new Promise<boolean>((r) => { release = r; }) });
    await t.ready;
    t.play();
    t.destroy();
    release(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.state).toBe('idle');
    const u = make({ trace: TRACE, prepare: () => false });
    await u.ready;
    const blocked = vi.fn();
    u.on('blocked', blocked);
    u.play();
    await vi.waitFor(() => expect(blocked).toHaveBeenCalled());
    expect(blocked.mock.calls[0][0].say).toBe('This guide can’t start yet.');
    let rejectIt: (e: Error) => void = () => {};
    const w = make({ trace: TRACE, prepare: () => new Promise<boolean>((_, rej) => { rejectIt = rej; }) });
    await w.ready;
    w.play();
    w.destroy();
    rejectIt(new Error('late'));
    await new Promise((r) => setTimeout(r, 0));
  });

  it('perform mode resets the app before every start after the first: restart, seek(0), play after the end', async () => {
    const { performer } = fakeHands();
    const onReset = vi.fn(async () => {});
    const t = make({ trace: TRACE, mode: 'perform', performer, onReset });
    await t.ready;
    t.play();
    await vi.waitFor(() => expect(t.state).toBe('playing'));
    expect(onReset).not.toHaveBeenCalled();
    clock.run(800);
    t.seek(0);
    await vi.waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(t.state).toBe('playing'));
    expect(t.time).toBeLessThan(100);
    clock.run(5000);
    expect(t.state).toBe('ended');
    t.play();
    await vi.waitFor(() => expect(onReset).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(t.state).toBe('playing'));
    // Overlay mode never calls it.
    const o = make({ trace: TRACE, onReset });
    await o.ready;
    o.play(); clock.run(5000); o.play();
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('resumeKey: saves each step, resumes on the next page from the following step, forgets at the end', async () => {
    sessionStorage.clear();
    const t = make({ trace: TRACE, resumeKey: 'tour' });
    await t.ready;
    t.play();
    clock.run(700);
    expect(JSON.parse(sessionStorage.getItem('trace-avatar:tour')!)).toMatchObject({ i: 0, n: 2 });
    t.destroy(); // the page unloads

    const again = make({ trace: TRACE, resumeKey: 'tour', autoplay: true });
    await again.ready;
    expect(again.index).toBe(1);
    const steps: number[] = [];
    again.on('step', (e) => steps.push(e.index));
    clock.run(3000);
    expect(steps).toEqual([1]);
    expect(again.state).toBe('ended');
    expect(sessionStorage.getItem('trace-avatar:tour')).toBeNull();
  });

  it('startAt plays from that step (a fixed guide carrying on); 0, out of range or fractional is safe', async () => {
    const t = make({ trace: TRACE, startAt: 1, autoplay: true });
    await t.ready;
    expect(t.index).toBe(1);
    const steps: number[] = [];
    t.on('step', (e) => steps.push(e.index));
    clock.run(3000);
    expect(steps).toEqual([1]);
    expect(t.state).toBe('ended');
    t.destroy();
    for (const startAt of [0, -1, 2, 9]) {
      const u = make({ trace: TRACE, startAt });
      await u.ready;
      expect(u.index).toBe(0);
      u.destroy();
    }
    const f = make({ trace: TRACE, startAt: 1.7 });
    await f.ready;
    expect(f.index).toBe(1);
    f.destroy();
  });

  it('resume is skipped when the save is old, for another trace, the last step, on the wrong page, or unreadable; stop forgets', async () => {
    const put = (v: unknown) => sessionStorage.setItem('trace-avatar:k', typeof v === 'string' ? v : JSON.stringify(v));
    const index = async (o: Partial<TraceOptions> = {}) => { const t = make({ trace: TRACE, resumeKey: 'k', ...o }); await t.ready; const i = t.index; const st = t.state; t.destroy(); return [i, st]; };
    put({ i: 0, n: 2, at: Date.now() - 11 * 60_000 });
    expect(await index()).toEqual([0, 'idle']);
    put({ i: 0, n: 5, at: Date.now() });
    expect(await index()).toEqual([0, 'idle']);
    put({ i: 1, n: 2, at: Date.now() });
    expect(await index()).toEqual([0, 'idle']);
    put('{not json');
    expect(await index()).toEqual([0, 'idle']);
    put({ i: 'x', n: 2, at: Date.now() });
    expect(await index()).toEqual([0, 'idle']);
    const paged: Trace = { version: 1, steps: [{ type: 'click', target: { sel: '#a' }, page: '/one' }, { type: 'click', target: { sel: '#b' }, page: '/two' }] };
    put({ i: 0, n: 2, at: Date.now() });
    expect(await index({ trace: paged, currentPath: () => '/one' })).toEqual([0, 'idle']);
    put({ i: 0, n: 2, at: Date.now() });
    expect(await index({ trace: paged, currentPath: () => '/two' })).toEqual([1, 'paused']);
    put({ i: 0, n: 2, at: Date.now() });
    const s = make({ trace: TRACE, resumeKey: 'k' });
    await s.ready;
    s.stop();
    expect(sessionStorage.getItem('trace-avatar:k')).toBeNull();
    // Storage that throws (private mode, blocked) means no resume and no crash.
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const rm = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    const q = make({ trace: TRACE, resumeKey: 'k' });
    await q.ready;
    q.play(); clock.run(5000); q.stop();
    expect(q.state).toBe('idle');
    get.mockRestore(); set.mockRestore(); rm.mockRestore();
  });

  it('wait … until uses the real page: holds until the text shows up', async () => {
    const tr: Trace = { version: 1, steps: [{ type: 'wait', target: { sel: '#a' }, until: { text: 'Running' }, timeout: 60_000 }, { type: 'click', target: { sel: '#b' } }] };
    const t = make({ trace: tr });
    await t.ready;
    t.play();
    clock.run(2000);
    expect(t.state).toBe('waiting');
    document.getElementById('a')!.textContent = 'Running';
    await new Promise((r) => setTimeout(r, 0));
    clock.run(2000);
    expect(t.index).toBe(1);
  });

  it('an until that times out reports the texts that showed while it waited (what the app said instead)', async () => {
    const tr: Trace = { version: 1, steps: [{ type: 'wait', until: { text: 'Saved' }, timeout: 1000 }, { type: 'note', say: 'x' }] };
    const t = make({ trace: tr });
    const stalls: unknown[] = [];
    t.on('stalled', (d) => stalls.push(d));
    await t.ready;
    t.play();
    clock.run(300);
    const toast = Object.assign(document.createElement('p'), { textContent: 'Invoice stored' });
    setRect(toast, 0, 0);
    document.body.append(toast);
    await new Promise((r) => setTimeout(r, 0));
    clock.run(1500);
    expect(stalls).toEqual([expect.objectContaining({ index: 0, reason: 'until-timeout', seen: [{ text: 'Invoice stored', element: toast }] })]);
    toast.remove();
  });
});
