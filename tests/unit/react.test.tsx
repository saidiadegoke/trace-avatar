// @vitest-environment happy-dom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceAvatar, optionsKey, useTrace } from '../../src/react/index';
import type { UseTraceOptions } from '../../src/react/index';
import type { TraceController } from '../../src/index';
import type { Trace } from '../../src/core/format';
import { html } from './dom-helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRACE: Trace = { version: 1, avatar: { name: 'Ada' }, steps: [{ type: 'click', target: { sel: '#a' }, t: 300 }] };
const hosts = () => document.querySelectorAll('[data-trace-avatar]').length;

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  html('<button id="a">A</button><div id="root"></div>');
  container = document.getElementById('root')!;
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });

function Probe(props: UseTraceOptions & { out: { ctl: TraceController | null } }) {
  const { out, ...opts } = props;
  out.ctl = useTrace(opts);
  return null;
}

describe('optionsKey', () => {
  it('is equal for equal options and different when a rebuilding option changes', () => {
    expect(optionsKey({ trace: TRACE })).toBe(optionsKey({ trace: JSON.parse(JSON.stringify(TRACE)) }));
    expect(optionsKey({ trace: TRACE })).not.toBe(optionsKey({ trace: TRACE, controls: true }));
    expect(optionsKey({ trace: TRACE, onStep: () => {} })).toBe(optionsKey({ trace: TRACE, onStep: () => {} }));
    expect(optionsKey({ trace: TRACE, rate: 1 })).toBe(optionsKey({ trace: TRACE, rate: 2 }));
  });
});

describe('useTrace / <TraceAvatar>', () => {
  it('creates on mount and destroys on unmount, once even under StrictMode', () => {
    const out = { ctl: null as TraceController | null };
    act(() => root.render(<StrictMode><Probe trace={TRACE} out={out} /></StrictMode>));
    expect(hosts()).toBe(1);
    expect(out.ctl?.state).toBe('idle');
    act(() => root.render(<StrictMode><div /></StrictMode>));
    expect(hosts()).toBe(0);
  });

  it('does not rebuild on an equal re-render, rebuilds when options change', () => {
    const out = { ctl: null as TraceController | null };
    act(() => root.render(<Probe trace={TRACE} out={out} />));
    const first = out.ctl;
    act(() => root.render(<Probe trace={JSON.parse(JSON.stringify(TRACE))} out={out} />));
    expect(out.ctl).toBe(first);
    act(() => root.render(<Probe trace={TRACE} controls out={out} />));
    expect(out.ctl).not.toBe(first);
    expect(hosts()).toBe(1);
  });

  it('applies rate changes without rebuilding', () => {
    const out = { ctl: null as TraceController | null };
    act(() => root.render(<Probe trace={TRACE} out={out} rate={1} />));
    const first = out.ctl!;
    const spy = vi.spyOn(first, 'setRate');
    act(() => root.render(<Probe trace={TRACE} out={out} rate={2} />));
    expect(out.ctl).toBe(first);
    expect(spy).toHaveBeenCalledWith(2);
  });

  it('calls the latest handlers', () => {
    const out = { ctl: null as TraceController | null };
    const a = vi.fn();
    const b = vi.fn();
    act(() => root.render(<Probe trace={TRACE} out={out} onState={a} />));
    act(() => root.render(<Probe trace={TRACE} out={out} onState={b} />));
    act(() => out.ctl!.play());
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith('playing');
  });

  it('wires step, stalled, end and error handlers', () => {
    // A manual clock port lets the test play the trace frame by frame.
    let now = 0;
    const cbs: Array<() => void> = [];
    const clock = { now: () => now, raf: (cb: () => void) => { cbs.push(cb); return cbs.length; }, caf: () => {} };
    const tick = (n: number) => { for (let k = 0; k < n; k += 1) { now += 16; cbs.splice(0).forEach((cb) => cb()); } };
    const out = { ctl: null as TraceController | null };
    const onStep = vi.fn();
    const onEnd = vi.fn();
    const onStalled = vi.fn();
    const two: Trace = { version: 1, steps: [{ type: 'click', target: { sel: '#a' }, t: 100 }, { type: 'click', target: { sel: '#gone' }, t: 300, timeout: 100 }] };
    act(() => root.render(<Probe trace={two} out={out} onStep={onStep} onEnd={onEnd} onStalled={onStalled} ports={{ clock }} />));
    act(() => { out.ctl!.play(); tick(200); });
    expect(onStep.mock.calls.map((c) => c[0].index)).toEqual([0, 1]);
    expect(onStalled).toHaveBeenCalledWith(expect.objectContaining({ index: 1, reason: 'not-found' }));
    expect(onEnd).toHaveBeenCalledTimes(1);

    const onError = vi.fn();
    act(() => root.render(<Probe trace={{ version: 1, steps: [] } as unknown as Trace} out={out} onError={onError} />));
    expect(onError).toHaveBeenCalled();
    expect(out.ctl).toBeNull();
  });

  it('wires onPage, and navigate always calls the latest function', () => {
    let now = 0;
    const cbs: Array<() => void> = [];
    const clock = { now: () => now, raf: (cb: () => void) => { cbs.push(cb); return cbs.length; }, caf: () => {} };
    const tick = (n: number) => { for (let k = 0; k < n; k += 1) { now += 16; cbs.splice(0).forEach((cb) => cb()); } };
    const out = { ctl: null as TraceController | null };
    const paged: Trace = { version: 1, steps: [{ type: 'note', say: 'a', t: 100, page: '/one' }, { type: 'note', say: 'b', t: 3000, page: '/two' }] };
    let path = '/elsewhere';
    const first = vi.fn((p: string) => { path = p; });
    const second = vi.fn((p: string) => { path = p; });
    const onPage = vi.fn();
    const currentPath = () => path;
    act(() => root.render(<Probe trace={paged} out={out} navigate={first} onPage={onPage} currentPath={currentPath} ports={{ clock }} />));
    act(() => { out.ctl!.play(); tick(3); });
    expect(first).toHaveBeenCalledWith('/one');
    expect(onPage).toHaveBeenCalledWith(expect.objectContaining({ index: 0, want: '/one', at: '/elsewhere' }));
    // A new router function on re-render: same trace (no rebuild), the new function is used.
    act(() => root.render(<Probe trace={paged} out={out} navigate={second} onPage={onPage} currentPath={currentPath} ports={{ clock }} />));
    act(() => { tick(400); });
    expect(second).toHaveBeenCalledWith('/two');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('prepare, onReset and currentPath are read from the latest render; onHandoff and onBlocked are wired', async () => {
    let now = 0;
    const cbs: Array<() => void> = [];
    const clock = { now: () => now, raf: (cb: () => void) => { cbs.push(cb); return cbs.length; }, caf: () => {} };
    const tick = (n: number) => { for (let k = 0; k < n; k += 1) { now += 16; cbs.splice(0).forEach((cb) => cb()); } };
    const out = { ctl: null as TraceController | null };
    const masked: Trace = { version: 1, steps: [{ type: 'type', target: { sel: '#a' }, text: '•', mask: true, t: 50, page: '/p' }] };
    const performer = () => ({ click() {}, hover() {}, key() {}, startTyping: (x: Element) => x, typeTo() {}, finishTyping() {}, focus() {} });
    const no = vi.fn(() => false);
    const yes = vi.fn(() => true);
    const reset1 = vi.fn();
    const reset2 = vi.fn();
    const onBlocked = vi.fn();
    const onHandoff = vi.fn();
    const path1 = () => '/elsewhere';
    const path2 = () => '/p';
    const props = { trace: masked, out, mode: 'perform' as const, performer, onBlocked, onHandoff, ports: { clock } };
    act(() => root.render(<Probe {...props} prepare={no} onReset={reset1} currentPath={path1} />));
    await act(async () => { out.ctl!.play(); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(onBlocked).toHaveBeenCalled());
    act(() => root.render(<Probe {...props} prepare={yes} onReset={reset2} currentPath={path2} />));
    await act(async () => { out.ctl!.play(); });
    await vi.waitFor(() => expect(out.ctl!.state).toBe('playing'));
    act(() => { tick(60); });
    expect(onHandoff).toHaveBeenCalled();
    expect([no.mock.calls.length, yes.mock.calls.length]).toEqual([1, 1]);
    await act(async () => { out.ctl!.stop(); out.ctl!.play(); });
    await vi.waitFor(() => expect(reset2).toHaveBeenCalled());
    expect(reset1).not.toHaveBeenCalled();
    // A render without prepare / currentPath falls back (true; location.pathname).
    act(() => root.render(<Probe {...props} prepare={undefined} currentPath={undefined} onReset={undefined} />));
  });

  it('a prepare removed on a later render lets the guide start', async () => {
    const out = { ctl: null as TraceController | null };
    act(() => root.render(<Probe trace={TRACE} out={out} prepare={() => false} />));
    act(() => root.render(<Probe trace={TRACE} out={out} />));
    await act(async () => { out.ctl!.play(); });
    await vi.waitFor(() => expect(out.ctl!.state).toBe('playing'));
  });

  it('enabled={false} creates nothing', () => {
    const out = { ctl: null as TraceController | null };
    act(() => root.render(<Probe trace={TRACE} out={out} enabled={false} />));
    expect(out.ctl).toBeNull();
    expect(hosts()).toBe(0);
  });

  it('<TraceAvatar> renders nothing into the tree and mounts the overlay', () => {
    act(() => root.render(<TraceAvatar trace={TRACE} autoplay />));
    expect(container.innerHTML).toBe('');
    expect(hosts()).toBe(1);
  });
});
