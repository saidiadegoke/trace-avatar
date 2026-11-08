// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { View } from '../../src/core/player';
import { createRenderer, initials } from '../../src/shell/renderer.shadow';
import type { RendererOptions } from '../../src/shell/renderer.shadow';

const vp = { w: 1280, h: 800 };
const base: View = { phase: 'playing', cursor: { x: 100, y: 120, pressed: false, visible: true }, ring: null, caption: null, chip: null, index: 0, count: 3 };
const v = (over: Partial<View> = {}, cursor: Partial<View['cursor']> = {}): View => ({ ...base, ...over, cursor: { ...base.cursor, ...cursor } });
const make = (o: Partial<RendererOptions> = {}) => createRenderer({ avatar: { name: 'Sarah Lee' }, captions: 'bubble', controls: false, touch: false, ...o });
const q = (r: ReturnType<typeof make>, sel: string) => r.root.querySelector(sel) as HTMLElement;

afterEach(() => { document.body.innerHTML = ''; });

describe('initials', () => {
  it('takes first and last initials', () => {
    expect(initials('Sarah Lee')).toBe('SL');
    expect(initials('ada')).toBe('A');
    expect(initials('Jean Paul Sartre')).toBe('JS');
    expect(initials('  ')).toBe('•');
    expect(initials('— Bob')).toBe('B');
  });
});

describe('renderer', () => {
  it('mounts one click-through host with a shadow root and its stylesheet', () => {
    const r = make();
    expect(document.querySelectorAll('[data-trace-avatar]')).toHaveLength(1);
    expect(r.host.shadowRoot).toBe(r.root);
    expect(r.root.querySelector('style')!.textContent).toContain('pointer-events:none');
  });

  it('shows initials, or the image, and the name', () => {
    const r = make();
    expect(q(r, '.av').textContent).toBe('SL');
    expect(q(r, '.name').textContent).toBe('Sarah Lee');
    const r2 = make({ avatar: { name: 'Sarah · Sales', image: '/s.png' } });
    expect((q(r2, 'img.av') as HTMLImageElement).getAttribute('src')).toBe('/s.png');
    const r3 = make({ avatar: {} });
    expect(q(r3, '.badge')).toBeNull();
    const r4 = make({ avatar: { name: 'Sarah · Sales' } });
    expect(q(r4, '.av').textContent).toBe('S');
  });

  it('applies the avatar colour as a custom property', () => {
    const r = make({ avatar: { color: '#ff0000' } });
    expect(r.host.style.getPropertyValue('--ta-color')).toBe('#ff0000');
  });

  it('moves the cursor with a transform and only writes when something changed', () => {
    const r = make();
    const cur = q(r, '.cur');
    r.apply(v(), vp);
    expect(cur.style.transform).toBe('translate3d(100px,120px,0)');
    expect(cur.className).toBe('cur on');
    // Tamper with the style: an unchanged view must not write it again; a changed one must.
    cur.style.transform = 'none';
    r.apply(v(), vp);
    expect(cur.style.transform).toBe('none');
    r.apply(v({}, { x: 101 }), vp);
    expect(cur.style.transform).toBe('translate3d(101px,120px,0)');
  });

  it('sets pressed, hidden, touch and flip classes', () => {
    const r = make({ touch: true });
    r.apply(v({}, { pressed: true }), vp);
    expect(q(r, '.cur').className).toBe('cur touch on down');
    r.apply(v({}, { x: 1200, y: 750 }), vp);
    expect(q(r, '.cur').className).toBe('cur touch on left up');
    r.apply(v({}, { visible: false }), vp);
    expect(q(r, '.cur').className).toBe('cur touch');
  });

  it('draws the ring around the box and fades it when gone', () => {
    const r = make();
    const ring = q(r, '.ring');
    r.apply(v({ ring: { x: 10, y: 20, w: 100, h: 40 } }), vp);
    expect(ring.style.transform).toBe('translate3d(6px,16px,0)');
    expect(ring.style.width).toBe('108px');
    expect(ring.style.height).toBe('48px');
    expect(ring.classList.contains('on')).toBe(true);
    r.apply(v(), vp);
    expect(ring.classList.contains('on')).toBe(false);
    expect(ring.style.width).toBe('108px');
  });

  it('bubble captions: visible bubble plus a screen-reader live region', () => {
    const r = make();
    r.apply(v({ caption: { text: 'Start here', key: 0 } }), vp);
    expect(q(r, '.bubble').textContent).toBe('Start here');
    expect(q(r, '.bubble').classList.contains('on')).toBe(true);
    const live = q(r, '[aria-live]');
    expect(live.className).toBe('sr');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe('Start here');
    r.apply(v(), vp);
    expect(q(r, '.bubble').classList.contains('on')).toBe(false);
    expect(live.textContent).toBe('');
  });

  it('bar captions: the live region is the visible bar', () => {
    const r = make({ captions: 'bar' });
    r.apply(v({ caption: { text: 'Hello', key: 1 } }), vp);
    const bar = q(r, '.bar');
    expect(bar.textContent).toBe('Hello');
    expect(bar.classList.contains('on')).toBe(true);
    expect(bar.getAttribute('aria-live')).toBe('polite');
  });

  it('no captions: nothing shown or announced; hidden cursor hides captions', () => {
    const r = make({ captions: 'none' });
    r.apply(v({ caption: { text: 'Hello', key: 1 } }), vp);
    expect(q(r, '[aria-live]').textContent).toBe('');
    const r2 = make();
    r2.apply(v({ caption: { text: 'Hello', key: 1 } }, { visible: false }), vp);
    expect(q(r2, '.bubble').classList.contains('on')).toBe(false);
  });

  it('only re-announces when the caption changes', () => {
    const r = make();
    const live = q(r, '[aria-live]');
    r.apply(v({ caption: { text: 'A', key: 0 } }), vp);
    const set = vi.spyOn(live, 'textContent', 'set');
    r.apply(v({ caption: { text: 'A', key: 0 } }), vp);
    expect(set).not.toHaveBeenCalled();
    r.apply(v({ caption: { text: 'B', key: 1 } }), vp);
    expect(set).toHaveBeenCalledWith('B');
  });

  it('shows and hides the typing chip', () => {
    const r = make();
    r.apply(v({ chip: 'hel' }), vp);
    expect(q(r, '.chip').textContent).toBe('hel');
    expect(q(r, '.chip').classList.contains('on')).toBe(true);
    r.apply(v({ chip: null }), vp);
    expect(q(r, '.chip').classList.contains('on')).toBe(false);
  });

  it('pools ripples, alternating animations to restart them', () => {
    const r = make();
    const rips = Array.from(r.root.querySelectorAll('.rip')) as HTMLElement[];
    expect(rips).toHaveLength(4);
    r.ripple(5, 6);
    expect(rips[0].className).toBe('rip a');
    expect(rips[0].style.getPropertyValue('--p')).toBe('translate(5px,6px)');
    for (let k = 0; k < 4; k += 1) r.ripple(1, 1);
    expect(rips[0].className).toBe('rip b');
    expect(r.root.querySelectorAll('.rip')).toHaveLength(4);
  });

  it('controls: labelled buttons send commands; counter, play label and rate update', () => {
    const onCommand = vi.fn();
    let rate = 1;
    const r = make({ controls: true, onCommand, rate: () => rate });
    const bar = q(r, '[role=toolbar]');
    expect(bar.getAttribute('aria-label')).toBe('Guide controls');
    const btns = Array.from(bar.querySelectorAll('button')) as HTMLButtonElement[];
    expect(btns.map((b) => b.getAttribute('aria-label'))).toEqual(['Previous step', 'Play', 'Next step', 'Playback speed', 'Restart']);
    btns.forEach((b) => b.click());
    expect(onCommand.mock.calls.map((c) => c[0])).toEqual(['prev', 'toggle', 'next', 'rate', 'restart']);
    r.apply(v({ index: 1, count: 3 }), vp);
    expect(q(r, '.n').textContent).toBe('2 / 3');
    expect(btns[1].getAttribute('aria-label')).toBe('Pause');
    r.apply(v({ phase: 'paused', index: 5, count: 3 }), vp);
    expect(btns[1].getAttribute('aria-label')).toBe('Play');
    expect(q(r, '.n').textContent).toBe('3 / 3');
    expect(btns[3].textContent).toBe('1×');
    rate = 2;
    r.apply(v(), vp);
    expect(btns[3].textContent).toBe('2×');
  });

  it('destroy removes everything', () => {
    const r = make({ controls: true });
    r.destroy();
    expect(document.querySelectorAll('[data-trace-avatar]')).toHaveLength(0);
  });
});
