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
