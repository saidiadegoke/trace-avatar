// @vitest-environment happy-dom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountOptions } from '../../src/auto/index';

const calls: Array<{ opts: MountOptions; destroyed: boolean; errorFns: Array<(e: Error) => void> }> = [];
vi.mock('../../src/auto/index', () => ({
  mount: (opts: MountOptions) => {
    const entry = { opts, destroyed: false, errorFns: [] as Array<(e: Error) => void> };
    calls.push(entry);
    return {
      on: (ev: string, fn: (e: Error) => void) => { if (ev === 'error') entry.errorFns.push(fn); return () => { entry.errorFns = entry.errorFns.filter((f) => f !== fn); }; },
      destroy: () => { entry.destroyed = true; },
    };
  },
}));
const { TraceGuides, guidesKey } = await import('../../src/react/index');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const M = { version: 1 as const, guides: [] };
let root: ReturnType<typeof createRoot>;
beforeEach(() => { calls.length = 0; document.body.innerHTML = '<div id="r"></div>'; root = createRoot(document.getElementById('r')!); });
afterEach(() => { act(() => root.unmount()); });

describe('<TraceGuides>', () => {
  it('mounts once (StrictMode too), passes options, unmounts with destroy', () => {
    const ready = vi.fn();
    act(() => root.render(<StrictMode><TraceGuides guides={M} perform launcher="bottom-left" onReady={ready} /></StrictMode>));
    const live = calls.filter((c) => !c.destroyed);
    expect(live).toHaveLength(1);
    expect(live[0].opts).toMatchObject({ guides: M, perform: true, launcher: 'bottom-left' });
    expect(ready.mock.calls[ready.mock.calls.length - 1][0]).not.toBeNull();
    act(() => root.render(<></>));
    expect(calls.every((c) => c.destroyed)).toBe(true);
    expect(ready.mock.calls[ready.mock.calls.length - 1][0]).toBeNull();
  });

  it('re-renders with equal options keep it; changed ones remount', () => {
    act(() => root.render(<TraceGuides guides={M} />));
    act(() => root.render(<TraceGuides guides={{ ...M }} />));
    expect(calls).toHaveLength(1);
    act(() => root.render(<TraceGuides guides={M} perform />));
    expect(calls).toHaveLength(2);
    expect(calls[0].destroyed).toBe(true);
  });

  it('functions come from the latest render; absent ones stay absent; errors reach onError', () => {
    const nav1 = vi.fn(); const nav2 = vi.fn();
    const prep1 = vi.fn(() => false); const prep2 = vi.fn(() => true);
    const reset2 = vi.fn();
    const onError = vi.fn();
    act(() => root.render(<TraceGuides guides={M} navigate={nav1} prepare={prep1} onReset={vi.fn()} currentPath={() => '/a'} onError={onError} />));
    act(() => root.render(<TraceGuides guides={M} navigate={nav2} prepare={prep2} onReset={reset2} currentPath={() => '/b'} onError={onError} />));
    const o = calls[0].opts;
    o.navigate!('/x');
    expect(nav2).toHaveBeenCalledWith('/x');
    expect(nav1).not.toHaveBeenCalled();
    expect(o.prepare!([], {} as never)).toBe(true);
    void o.onReset!();
    expect(reset2).toHaveBeenCalled();
    expect(o.currentPath!()).toBe('/b');
    act(() => root.render(<TraceGuides guides={M} navigate={nav2} onError={onError} />));
    expect(o.prepare!([], {} as never)).toBe(true); // removed later: lets the guide start
    expect(o.currentPath!()).toBe(location.pathname);
    calls[0].errorFns.forEach((f) => f(new Error('boom')));
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    act(() => root.render(<TraceGuides guides={M} perform />)); // a remount without functions
    expect(calls[1].opts).toMatchObject({ navigate: undefined, prepare: undefined, onReset: undefined, currentPath: undefined });
  });

  it('guidesKey covers what needs a remount', () => {
    expect(guidesKey({ guides: M })).toBe(guidesKey({ guides: { ...M } }));
    expect(guidesKey({ guides: M })).not.toBe(guidesKey({ guides: M, launcher: false }));
    expect(guidesKey({ guides: M })).not.toBe(guidesKey({ guides: '/g.json' }));
  });

  it('record: allowed and save come from the latest render; adding or changing its settings remounts', async () => {
    const save1 = vi.fn(); const save2 = vi.fn();
    act(() => root.render(<TraceGuides guides={M} record={{ allowed: () => false, save: save1, requires: ['a'] }} />));
    act(() => root.render(<TraceGuides guides={M} record={{ allowed: () => true, save: save2, requires: ['a'] }} />));
    expect(calls).toHaveLength(1);
    const r = calls[0].opts.record!;
    expect(r.allowed()).toBe(true);
    await r.save!({ version: 1, steps: [] }, { id: 'x', title: 'X', trace: 'x.trace.json' }, { from: 'x' });
    expect(save2).toHaveBeenCalledTimes(1);
    expect(save2.mock.calls[0][2]).toEqual({ from: 'x' });
    expect(save1).not.toHaveBeenCalled();
    expect(r.requires).toEqual(['a']);
    act(() => root.render(<TraceGuides guides={M} record={{ allowed: () => true, save: save2, requires: ['b'] }} />));
    expect(calls).toHaveLength(2);
    act(() => root.render(<TraceGuides guides={M} />));
    expect(calls).toHaveLength(3);
    expect(calls[2].opts.record).toBeUndefined();
    expect(guidesKey({ guides: M })).not.toBe(guidesKey({ guides: M, record: { allowed: () => true } }));
    expect(guidesKey({ guides: M, record: { allowed: () => true, shortcut: false } })).not.toBe(guidesKey({ guides: M, record: { allowed: () => true } }));
    act(() => root.render(<TraceGuides guides={M} record={{ allowed: () => true }} />));
    expect(calls[3].opts.record!.save).toBeUndefined();
    expect(calls[3].opts.record!.ai).toBeUndefined();
  });

  it('record.ai comes from the latest render, and adding it remounts', async () => {
    const ai1 = vi.fn(async () => 1); const ai2 = vi.fn(async () => 2);
    act(() => root.render(<TraceGuides guides={M} record={{ allowed: () => true, ai: ai1 }} />));
    act(() => root.render(<TraceGuides guides={M} record={{ allowed: () => true, ai: ai2 }} />));
    expect(calls).toHaveLength(1);
    expect(await calls[0].opts.record!.ai!('title', {}, {}, { instructions: '' })).toBe(2);
    expect(ai1).not.toHaveBeenCalled();
    expect(guidesKey({ guides: M, record: { allowed: () => true, ai: ai1 } })).not.toBe(guidesKey({ guides: M, record: { allowed: () => true } }));
  });
});
