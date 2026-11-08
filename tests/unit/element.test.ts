// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceAvatarElement, define } from '../../src/element/index';
import type { Trace } from '../../src/core/format';
import { html } from './dom-helpers';

const TRACE: Trace = { version: 1, steps: [{ type: 'click', target: { sel: '#a' }, t: 300 }] };
const hosts = () => document.querySelectorAll('[data-trace-avatar]').length;
const make = () => document.createElement('trace-avatar') as TraceAvatarElement;

beforeEach(() => html('<button id="a">A</button>'));
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('<trace-avatar>', () => {
  it('registers once', () => {
    expect(customElements.get('trace-avatar')).toBe(TraceAvatarElement);
    define();
    define('trace-avatar-2');
    expect(customElements.get('trace-avatar-2')!.prototype).toBeInstanceOf(TraceAvatarElement);
    define('trace-avatar-2');
  });

  it('reads options from attributes', () => {
    const el = make();
    expect(el.options()).toBeNull();
    el.setAttribute('src', '/t.json');
    el.setAttribute('controls', '');
    el.setAttribute('loop', '');
    el.setAttribute('captions', 'bar');
    el.setAttribute('rate', '1.5');
    el.setAttribute('takeover', 'ignore');
    el.setAttribute('avatar-name', 'Ada');
    el.setAttribute('avatar-color', '#f00');
    expect(el.options()).toEqual({
      trace: '/t.json', controls: true, autoplay: false, loop: true, keyboard: false, captions: 'bar', takeover: 'ignore', rate: 1.5,
      avatar: { name: 'Ada', color: '#f00' },
    });
    el.setAttribute('avatar-image', '/a.png');
    expect(el.options()!.avatar).toEqual({ name: 'Ada', image: '/a.png', color: '#f00' });
    el.setAttribute('rate', 'fast');
    expect(el.options()!.rate).toBeUndefined();
  });

  it('creates when connected with a trace, destroys when removed', () => {
    const el = make();
    el.trace = TRACE;
    expect(hosts()).toBe(0); // not connected yet
    document.body.appendChild(el);
    expect(el.style.display).toBe('none');
    expect(hosts()).toBe(1);
    expect(el.controller?.state).toBe('idle');
    el.remove();
    expect(hosts()).toBe(0);
    expect(el.controller).toBeNull();
  });

  it('rebuilds when an attribute changes, keeping one overlay', () => {
    const el = make();
    el.trace = TRACE;
    document.body.appendChild(el);
    const first = el.controller;
    el.setAttribute('controls', '');
    expect(el.controller).not.toBe(first);
    expect(hosts()).toBe(1);
  });

  it('delegates play, pause, next, prev, seek and stop', () => {
    const el = make();
    el.trace = TRACE;
    document.body.appendChild(el);
    const c = el.controller!;
    const spies = (['play', 'pause', 'next', 'prev', 'seek', 'stop'] as const).map((m) => vi.spyOn(c, m));
    el.play(); el.pause(); el.next(); el.prev(); el.seek(10); el.stop();
    spies.forEach((s) => expect(s).toHaveBeenCalled());
    expect(el.trace).toBe(TRACE);
  });

  it('re-dispatches events as DOM events', () => {
    const el = make();
    el.trace = TRACE;
    document.body.appendChild(el);
    const states: string[] = [];
    el.addEventListener('trace-state', (e) => states.push((e as CustomEvent).detail.phase));
    el.play();
    expect(states).toEqual(['playing']);
  });

  it('dispatches trace-page when the next step is on another page', async () => {
    const el = make();
    el.trace = { version: 1, steps: [{ type: 'note', say: 'hi', page: '/never-here' }] };
    document.body.appendChild(el);
    const pages: unknown[] = [];
    el.addEventListener('trace-page', (e) => pages.push((e as CustomEvent).detail));
    el.play();
    await vi.waitFor(() => expect(pages).toHaveLength(1));
    expect(pages[0]).toMatchObject({ index: 0, want: '/never-here' });
  });

  it('dispatches trace-error for an invalid trace', () => {
    const el = make();
    const err = vi.fn();
    el.addEventListener('trace-error', err);
    document.body.appendChild(el);
    el.trace = { version: 1, steps: [] } as unknown as Trace;
    expect(err).toHaveBeenCalled();
    expect(el.controller).toBeNull();
  });
});
