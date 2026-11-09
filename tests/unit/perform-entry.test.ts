// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as perform from '../../src/perform/index';
import { html } from './dom-helpers';

describe('trace-avatar/perform', () => {
  it('createTrace turns perform mode on with the performer wired in; mode: overlay turns it off', async () => {
    html('<button id="a">A</button>');
    const clicks: number[] = [];
    document.getElementById('a')!.addEventListener('click', () => clicks.push(1));
    let now = 0;
    const queue: Array<() => void> = [];
    const clock = { now: () => now, raf: (cb: () => void) => { queue.push(cb); return queue.length; }, caf: () => {} };
    const run = (ms: number) => { for (let t = 0; t < ms; t += 16) { now += 16; queue.splice(0).forEach((cb) => cb()); } };
    const trace = { version: 1 as const, steps: [{ type: 'click' as const, target: { sel: '#a' }, t: 100 }] };
    const t = perform.createTrace({ trace, ports: { clock } });
    t.play();
    run(1000);
    expect(clicks).toEqual([1]);
    t.destroy();
    const o = perform.createTrace({ trace, mode: 'overlay', ports: { clock } });
    o.play();
    run(1000);
    expect(clicks).toEqual([1]);
    expect(typeof perform.createPerformer).toBe('function');
    expect(typeof perform.parseCombo).toBe('function');
    expect(typeof perform.validate).toBe('function'); // everything from the main entry too
  });
});
