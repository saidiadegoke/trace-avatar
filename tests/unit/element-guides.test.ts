// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MountOptions } from '../../src/auto/index';

const calls: Array<{ opts: MountOptions; destroyed: boolean; fns: Record<string, (d: unknown) => void> }> = [];
vi.mock('../../src/auto/index', () => ({
  mount: (opts: MountOptions) => {
    const entry = { opts, destroyed: false, fns: {} as Record<string, (d: unknown) => void> };
    calls.push(entry);
    return { on: (ev: string, fn: (d: unknown) => void) => { entry.fns[ev] = fn; return () => {}; }, destroy: () => { entry.destroyed = true; } };
  },
}));
const { TraceGuidesElement, defineGuides } = await import('../../src/element/index');

afterEach(() => { calls.length = 0; document.body.innerHTML = ''; });
const make = () => document.createElement('trace-guides') as InstanceType<typeof TraceGuidesElement>;

describe('<trace-guides>', () => {
  it('registers once, under another name too', () => {
    expect(customElements.get('trace-guides')).toBe(TraceGuidesElement);
    defineGuides();
    defineGuides('trace-guides-2');
    expect(customElements.get('trace-guides-2')!.prototype).toBeInstanceOf(TraceGuidesElement);
    defineGuides('trace-guides-2');
  });

  it('reads options from attributes', () => {
    const el = make();
    expect(el.options()).toBeNull();
    el.setAttribute('src', '/g.json');
    expect(el.options()).toEqual({ guides: '/g.json', links: true, launcher: 'bottom-right', perform: false, controls: true, captions: undefined, rate: undefined });
    el.setAttribute('links', 'overlay');
    expect(el.options()!.links).toBe('overlay');
    el.setAttribute('links', 'off');
    expect(el.options()!.links).toBe(false);
    el.setAttribute('launcher', 'off');
    el.setAttribute('perform', '');
    el.setAttribute('controls', 'false');
    el.setAttribute('captions', 'bar');
    el.setAttribute('rate', '2');
    expect(el.options()).toMatchObject({ launcher: false, perform: true, controls: false, captions: 'bar', rate: 2 });
    el.setAttribute('launcher', 'bottom-left');
    el.setAttribute('rate', 'x');
    expect(el.options()).toMatchObject({ launcher: 'bottom-left', rate: undefined });
  });

  it('mounts when connected, remounts on changes and hooks, re-dispatches events, destroys when removed', () => {
    const el = make();
    el.setAttribute('src', '/g.json');
    document.body.append(el);
    expect(el.style.display).toBe('none');
    expect(calls).toHaveLength(1);
    expect(el.guides).not.toBeNull();
    const seen: string[] = [];
    for (const t of ['guides-ready', 'guides-play', 'guides-end', 'guides-stop', 'guides-error']) el.addEventListener(t, (e) => seen.push(`${t}:${(e as CustomEvent).detail}`));
    for (const k of ['ready', 'play', 'end', 'stop', 'error']) calls[0].fns[k](k);
    expect(seen).toEqual(['guides-ready:ready', 'guides-play:play', 'guides-end:end', 'guides-stop:stop', 'guides-error:error']);
    const navigate = vi.fn();
    el.hooks = { navigate };
    expect(el.hooks).toEqual({ navigate });
    expect(calls).toHaveLength(2);
    expect(calls[0].destroyed).toBe(true);
    expect(calls[1].opts.navigate).toBe(navigate);
    el.setAttribute('perform', '');
    expect(calls).toHaveLength(3);
    el.remove();
    expect(calls[2].destroyed).toBe(true);
    expect(el.guides).toBeNull();
    el.hooks = {}; // not connected: nothing mounts
    el.setAttribute('src', '/h.json');
    expect(calls).toHaveLength(3);
  });

  it('without src nothing mounts', () => {
    document.body.append(make());
    expect(calls).toHaveLength(0);
  });
});
