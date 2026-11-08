import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatKeys, initial, pointOf, update, view } from '../../src/core/player';
import type { Look } from '../../src/core/player';
import { CFG, Sim, box, trace } from './harness';

const A = box(100, 100);       // centre 150,120
const B = box(600, 400);       // centre 650,420
const C2 = box(900, 200, 50, 50);

const twoClicks = () => trace({ steps: [
  { type: 'click', target: { sel: '#a' }, t: 1000, say: 'First' },
  { type: 'click', target: { sel: '#b' }, t: 2000 },
] });

describe('lifecycle', () => {
  it('starts idle and hidden; frames do nothing while idle', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B });
    expect(sim.s.phase).toBe('idle');
    expect(sim.frame()).toEqual([]);
    expect(sim.view.cursor.visible).toBe(false);
    expect(sim.view.caption).toBeNull();
  });

  it('play starts at time zero; the first frame adds no time', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    expect(sim.s.phase).toBe('playing');
    expect(sim.t).toBe(0);
    sim.frame(16);
    expect(sim.t).toBe(16);
  });

  it('play while playing changes nothing', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    const before = sim.s;
    sim.send({ kind: 'play' });
    expect(sim.s).toBe(before);
  });

  it('fires every step in order, including the first (boilerplate bug 5)', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(5000);
    const steps = sim.fx.filter((f) => f.fx === 'step');
    expect(steps).toEqual([{ fx: 'step', i: 0, by: 'sel' }, { fx: 'step', i: 1, by: 'sel' }]);
  });

  it('fires a step at its action time, not before', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(990);
    expect(sim.kinds()).not.toContain('step');
    sim.until(1010);
    expect(sim.kinds()).toContain('step');
  });

  it('ripples at the click point', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(1010);
    expect(sim.fx).toContainEqual({ fx: 'ripple', x: 150, y: 120 });
  });

  it('ends with the cursor still visible on the last target (boilerplate bug 3)', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(99_999);
    expect(sim.s.phase).toBe('ended');
    expect(sim.kinds().filter((k) => k === 'end')).toHaveLength(1);
    expect(sim.t).toBe(sim.tr.duration);
    expect(sim.view.cursor).toMatchObject({ visible: true, x: 650, y: 420 });
    expect(sim.frame()).toEqual([]);
  });

  it('loops back to the start when asked', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }, { ...CFG, loop: true }).play();
    sim.run(sim.tr.duration + 200);
    expect(sim.s.phase).toBe('playing');
    expect(sim.kinds()).toContain('end');
    expect(sim.t).toBeLessThan(500);
  });

  it('play after the end restarts', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(99_999);
    sim.send({ kind: 'play' });
    expect(sim.s.phase).toBe('playing');
    expect(sim.t).toBe(0);
    expect(sim.s.fired).toBe(-1);
  });

  it('stop returns to idle, keeping the rate', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.send({ kind: 'rate', r: 2 });
    sim.run(500);
    sim.send({ kind: 'stop' });
    expect(sim.s).toEqual({ ...initial(2) });
  });
});

describe('pause, resume, rate, toggle', () => {
  it('pause keeps the position and resume continues without a jump (boilerplate bug 1)', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.run(400);
    const t = sim.t;
    sim.send({ kind: 'pause' });
    expect(sim.s.phase).toBe('paused');
    sim.run(5000);
    expect(sim.t).toBe(t);
    sim.send({ kind: 'play' });
    sim.frame(16);
    expect(sim.t).toBe(t);
    sim.frame(16);
    expect(sim.t).toBe(t + 16);
  });

  it('resuming mid-travel continues from where the cursor is', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(600);
    const p = { ...sim.s.pos! };
    sim.send({ kind: 'pause' });
    sim.send({ kind: 'play' });
    sim.frame(16);
    expect(Math.hypot(sim.s.pos!.x - p.x, sim.s.pos!.y - p.y)).toBeLessThan(2);
  });

  it('pause and takeover do nothing unless playing or waiting', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B });
    const before = sim.s;
    sim.send({ kind: 'pause' });
    sim.send({ kind: 'takeover' });
    expect(sim.s).toBe(before);
  });

  it('toggle switches between playing and paused', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B });
    sim.send({ kind: 'toggle' });
    expect(sim.s.phase).toBe('playing');
    sim.send({ kind: 'toggle' });
    expect(sim.s.phase).toBe('paused');
    sim.send({ kind: 'toggle' });
    expect(sim.s.phase).toBe('playing');
  });

  it('rate scales trace time', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.send({ kind: 'rate', r: 2 });
    sim.run(100, 10);
    expect(sim.t).toBe(200);
  });

  it('a long frame adds at most 100ms', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.frame(5000);
    expect(sim.t).toBe(100);
  });

  it('takeover pauses with a resume hint, only when hints are on', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.run(300);
    sim.send({ kind: 'takeover' });
    expect(sim.s).toMatchObject({ phase: 'paused', why: 'takeover' });
    expect(sim.view.caption?.text).toMatch(/Your turn/);
    sim.cfg = { ...CFG, resumeHint: false };
    expect(sim.view.caption?.text).not.toMatch(/Your turn/);
  });

  it('a pause step pauses at its end; play continues and does not pause there again', () => {
    const tr = trace({ steps: [
      { type: 'click', target: { sel: '#a' }, t: 1000, pause: true },
      { type: 'click', target: { sel: '#b' }, t: 2000 },
    ] });
    const sim = new Sim(tr, { 0: A, 1: B }).play();
    sim.until(5000);
    expect(sim.s).toMatchObject({ phase: 'paused', why: 'pause-step' });
    expect(sim.t).toBe(tr.end[0]);
    sim.send({ kind: 'play' });
    sim.until(99_999);
    expect(sim.s.phase).toBe('ended');
    expect(sim.fx.filter((f) => f.fx === 'step')).toHaveLength(2);
  });
});

describe('finding elements', () => {
  it('waits for a missing element without spending trace time, then carries on', () => {
    const sim = new Sim(twoClicks(), { 0: A }).play();
    sim.until(1300);
    expect(sim.s).toMatchObject({ phase: 'waiting', for: 'target', i: 1 });
    const held = sim.t;
    expect(held).toBeLessThanOrEqual(sim.tr.travelStart[1] + 16);
    expect(sim.view.caption?.text).toBe('Looking for “#b”…');
    sim.run(1000);
    expect(sim.t).toBe(held);
    sim.looks[1] = B;
    sim.frame();
    expect(sim.s.phase).toBe('playing');
    sim.frame(16);
    expect(sim.t).toBe(held + 16);
    sim.until(99_999);
    expect(sim.fx).toContainEqual({ fx: 'step', i: 1, by: 'sel' });
  });

  it('gives up after the timeout: stalled, then the step plays without its element', () => {
    const sim = new Sim(twoClicks(), { 0: A }).play();
    sim.until(1300);
    sim.run(4100);
    expect(sim.fx).toContainEqual({ fx: 'stalled', i: 1, reason: 'not-found' });
    expect(sim.s.phase).toBe('playing');
    sim.until(99_999);
    expect(sim.fx).toContainEqual({ fx: 'step', i: 1, by: null });
    expect(sim.fx.filter((f) => f.fx === 'ripple')).toHaveLength(1);
    // The cursor stayed on the last element it found.
    expect(sim.view.cursor).toMatchObject({ x: 150, y: 120 });
    expect(sim.view.ring).toBeNull();
  });

  it('a wait step holds until its element appears, with its own timeout', () => {
    const tr = trace({ steps: [{ type: 'wait', target: { sel: '#late' }, timeout: 300 }, { type: 'note', say: 'done' }] });
    const sim = new Sim(tr).play();
    sim.frame();
    expect(sim.s).toMatchObject({ phase: 'waiting', for: 'wait-step' });
    sim.run(320);
    expect(sim.fx).toContainEqual({ fx: 'stalled', i: 0, reason: 'wait-timeout' });
    sim.until(99_999);
    expect(sim.s.phase).toBe('ended');
  });

  it('a wait step passes straight through when its element is there', () => {
    const tr = trace({ steps: [{ type: 'wait', target: { sel: '#x' } }, { type: 'note', say: 'ok' }] });
    const sim = new Sim(tr, { 0: A }).play();
    sim.until(99_999);
    expect(sim.kinds()).not.toContain('stalled');
    expect(sim.s.phase).toBe('ended');
  });

  it('asks to reveal an off-screen element once, when travel starts', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: box(600, 2000, 100, 40, { inView: false }) }).play();
    sim.until(99_999);
    expect(sim.fx.filter((f) => f.fx === 'reveal')).toEqual([{ fx: 'reveal', i: 1 }]);
  });

  it('reports which locator found the element; a target with only xy uses it at once', () => {
    const tr = trace({ steps: [
      { type: 'click', target: { sel: '#a' }, t: 1000 },
      { type: 'click', target: { xy: { x: 5, y: 5 } }, t: 2000 },
    ] });
    const sim = new Sim(tr, { 0: box(1, 1, 1, 1, { by: 'role' }), 1: box(5, 5, 0, 0, { by: 'xy' }) }).play();
    sim.until(99_999);
    expect(sim.fx.filter((f) => f.fx === 'step')).toEqual([{ fx: 'step', i: 0, by: 'role' }, { fx: 'step', i: 1, by: 'xy' }]);
    expect(sim.kinds()).not.toContain('stalled');
  });

  it('a recorded pixel point does not stand in for a selector until looking gives up (the page may not be there yet)', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: box(400, 300, 0, 0, { by: 'xy' }) }).play();
    sim.until(1300);
    expect(sim.s.phase).toBe('waiting');
    sim.run(2000);
    expect(sim.s.phase).toBe('waiting');
    expect(sim.view.cursor).toMatchObject({ x: 150, y: 120 }); // still on the last real element
    sim.run(2200);
    expect(sim.fx).toContainEqual({ fx: 'stalled', i: 1, reason: 'not-found' });
    sim.until(99_999);
    expect(sim.fx).toContainEqual({ fx: 'step', i: 1, by: 'xy' });
    expect(sim.fx.filter((f) => f.fx === 'ripple')).toHaveLength(2);
    expect(sim.view.cursor).toMatchObject({ x: 400, y: 300 }); // then goes to the recorded point
  });

  it('if the element turns up while waiting, it is used, not the pixel point', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: box(400, 300, 0, 0, { by: 'xy' }) }).play();
    sim.until(1300);
    expect(sim.s.phase).toBe('waiting');
    sim.looks[1] = B;
    sim.run(100);
    expect(sim.s.phase).toBe('playing');
    sim.until(99_999);
    expect(sim.fx).toContainEqual({ fx: 'step', i: 1, by: 'sel' });
    expect(sim.kinds()).not.toContain('stalled');
  });

  it('emits scroll for scroll steps', () => {
    const tr = trace({ steps: [{ type: 'scroll', by: { y: 300 } }] });
    const sim = new Sim(tr).play();
    sim.until(99_999);
    expect(sim.fx).toContainEqual({ fx: 'scroll', i: 0 });
  });
});

describe('cursor motion', () => {
  it('enters near the first target, travels, and lands exactly on it at the action', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    const start = { ...sim.s.pos! };
    expect(start).not.toEqual({ x: 150, y: 120 });
    sim.until(1000);
    expect(sim.s.pos).toEqual({ x: 150, y: 120 });
  });

  it('follows its element when the element moves (scroll, layout)', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(1100);
    sim.looks[0] = box(100, 50);
    sim.frame();
    expect(sim.s.pos).toEqual({ x: 150, y: 70 });
  });

  it('aims at target.at within the box', () => {
    const tr = trace({ steps: [{ type: 'click', target: { sel: '#a', at: { rx: 0, ry: 1 } }, t: 500 }] });
    const sim = new Sim(tr, { 0: A }).play();
    sim.until(600);
    expect(sim.s.pos).toEqual({ x: 100, y: 140 });
    expect(pointOf(A, tr.steps[0])).toEqual({ x: 100, y: 140 });
  });

  it('jumps instead of travelling under reduced motion', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }, { ...CFG, reducedMotion: true }).play();
    sim.until(sim.tr.travelStart[1] + 20);
    expect(sim.s.pos).toEqual({ x: 650, y: 420 });
  });

  it('presses on click (and twice on dblclick)', () => {
    const tr = trace({ steps: [{ type: 'dblclick', target: { sel: '#a' }, t: 500 }] });
    const sim = new Sim(tr, { 0: A }).play();
    sim.until(500, 4);
    sim.frame(4);
    expect(sim.view.cursor.pressed).toBe(true);
    sim.until(700, 4);
    expect(sim.s.pressed).toBe(false);
    sim.until(sim.tr.at[0] + 230, 4);
    expect(sim.s.pressed).toBe(true);
    sim.until(sim.tr.at[0] + 400, 4);
    expect(sim.s.pressed).toBe(false);
  });

  it('plays a recorded path, re-anchored to the live elements', () => {
    const tr = trace({
      meta: { viewport: { w: 1280, h: 800 } },
      steps: [{ type: 'click', target: { sel: '#a' }, t: 0 }, { type: 'click', target: { sel: '#b' }, t: 1000 }],
      path: [[0, 150, 120], [500, 400, 600], [1000, 640, 400]],
    });
    const sim = new Sim(tr, { 0: A, 1: B }).play();
    sim.until(tr.travelStart[1] + 1, 1);
    sim.until(1000, 4);
    expect(sim.s.pos).toEqual({ x: 650, y: 420 });
    // Midway it follows the recorded bend down to y≈600, not a straight line between the targets.
    const sim2 = new Sim(tr, { 0: A, 1: B }).play();
    sim2.until(500, 4);
    expect(sim2.s.pos!.y).toBeGreaterThan(500);
  });

  it('pins the start of a leg that has no previous element, so it cannot drift', () => {
    const tr = trace({ steps: [{ type: 'click', target: { sel: '#a' }, t: 2000 }] });
    const sim = new Sim(tr, { 0: A }).play();
    const entry = { ...sim.s.leg.from! };
    sim.until(1600);
    expect(sim.s.leg.from).toEqual(entry);
  });

  it('recorded path: starts where the recording starts, keeps its offset over steps without a target', () => {
    const tr = trace({
      steps: [{ type: 'note', say: 'look', t: 0, hold: 100 }, { type: 'click', target: { sel: '#a' }, t: 1000 }],
      path: [[0, 10, 10], [1000, 140, 110]],
    });
    const sim = new Sim(tr, { 1: A }).play();
    expect(sim.s.pos).toEqual({ x: 10, y: 10 });
    sim.until(50, 2);
    // During the note (no target) it simply follows the recording.
    expect(sim.s.pos!.x).toBeCloseTo(10 + 130 * (sim.t / 1000), 0);
    sim.until(600, 4);
    // Later it follows the recording, drifting toward the live element (recording ends 10px short of it).
    const rec = 10 + 130 * (sim.t / 1000);
    expect(sim.s.pos!.x).toBeGreaterThan(rec);
    expect(sim.s.pos!.x).toBeLessThan(rec + 10);
    sim.until(1000, 4);
    expect(sim.s.pos).toEqual({ x: 150, y: 120 });
  });

  it('stays put between steps on the previous element', () => {
    const tr = trace({ steps: [{ type: 'click', target: { sel: '#a' }, t: 500 }, { type: 'click', target: { sel: '#b' }, t: 5000 }] });
    const sim = new Sim(tr, { 0: A, 1: B }).play();
    sim.until(3000);
    expect(sim.s.pos).toEqual({ x: 150, y: 120 });
  });
});

describe('seek, next, prev', () => {
  it('seek sets the step and what has fired, without effects', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    const fx = sim.send({ kind: 'seek', t: 2100 });
    expect(fx).toEqual([]);
    expect(sim.s).toMatchObject({ i: 1, fired: 1, phase: 'playing' });
    sim.until(99_999);
    expect(sim.fx.filter((f) => f.fx === 'step')).toEqual([]);
  });

  it('seeking back lets steps fire again', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(99_999);
    sim.fx = [];
    sim.send({ kind: 'seek', t: 0 });
    expect(sim.s.phase).toBe('paused');
    sim.send({ kind: 'play' });
    sim.until(99_999);
    expect(sim.fx.filter((f) => f.fx === 'step')).toHaveLength(2);
  });

  it('seek clamps, and seeking to the end ends', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B });
    sim.send({ kind: 'seek', t: -50 });
    expect(sim.t).toBe(0);
    expect(sim.s.phase).toBe('paused');
    sim.send({ kind: 'seek', t: 1e9 });
    expect(sim.s.phase).toBe('ended');
    expect(sim.t).toBe(sim.tr.duration);
  });

  it('seek marks pause steps already passed so they do not pause again', () => {
    const tr = trace({ steps: [{ type: 'click', target: { sel: '#a' }, t: 500, pause: true }, { type: 'click', target: { sel: '#b' }, t: 2000 }] });
    const sim = new Sim(tr, { 0: A, 1: B });
    sim.send({ kind: 'seek', t: 1500 });
    expect(sim.s.pausedAt).toBe(0);
  });

  it('seek gives the same picture as playing to that time (golden frames)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 200 }), (k) => {
      const tr = trace({ steps: [
        { type: 'click', target: { sel: '#a' }, t: 600 },
        { type: 'type', target: { sel: '#b' }, text: 'hello', t: 1800, say: 'Type' },
        { type: 'hover', target: { sel: '#c' }, t: 3000 },
      ] });
      const looks = { 0: A, 1: B, 2: C2 };
      const played = new Sim(tr, looks).play();
      for (let j = 0; j < k; j += 1) played.frame(16);
      const sought = new Sim(tr, looks);
      sought.send({ kind: 'seek', t: played.t });
      sought.frame();
      const a = played.view;
      const b = sought.view;
      return Math.abs(a.cursor.x - b.cursor.x) < 1e-6 && Math.abs(a.cursor.y - b.cursor.y) < 1e-6
        && JSON.stringify(a.ring) === JSON.stringify(b.ring) && a.chip === b.chip && a.caption?.text === b.caption?.text;
    }), { numRuns: 60 });
  });

  it('next finishes the current step, then jumps a whole step', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B });
    sim.send({ kind: 'next' });
    expect(sim.t).toBe(sim.tr.end[0]);
    expect(sim.s.i).toBe(1);
    sim.send({ kind: 'next' });
    expect(sim.s.phase).toBe('ended');
  });

  it('next from the last step ends the trace', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B });
    sim.send({ kind: 'seek', t: sim.tr.end[0] });
    sim.send({ kind: 'next' });
    sim.send({ kind: 'next' });
    expect(sim.t).toBe(sim.tr.duration);
  });

  it('prev goes to the start of the current step, then the one before', () => {
    const tr = trace({ steps: [
      { type: 'click', target: { sel: '#a' }, t: 1000 },
      { type: 'click', target: { sel: '#b' }, t: 3000 },
      { type: 'click', target: { sel: '#c' }, t: 5000 },
    ] });
    const sim = new Sim(tr, { 0: A, 1: B, 2: C2 });
    sim.send({ kind: 'seek', t: 4900 });
    sim.send({ kind: 'prev' });
    expect(sim.t).toBe(tr.end[1]);
    expect(sim.s.i).toBe(2);
    sim.send({ kind: 'prev' });
    expect(sim.t).toBe(tr.end[0]);
    sim.send({ kind: 'prev' });
    sim.send({ kind: 'prev' });
    expect(sim.t).toBe(0);
  });
});

describe('view', () => {
  it('rings the target late in the travel and through the action', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(300);
    expect(sim.view.ring).toBeNull();
    sim.until(800);
    expect(sim.view.ring).toEqual({ x: 100, y: 100, w: 100, h: 40 });
  });

  it('does not ring when highlight is off, the step does not travel, or the box is empty', () => {
    const tr = trace({ steps: [
      { type: 'click', target: { sel: '#a' }, t: 500, highlight: false },
      { type: 'click', target: { xy: { x: 5, y: 5 } }, t: 2000 },
    ] });
    const sim = new Sim(tr, { 0: A, 1: box(5, 5, 0, 0, { by: 'xy' }) }).play();
    sim.until(600);
    expect(sim.view.ring).toBeNull();
    sim.until(2050);
    expect(sim.view.ring).toBeNull();
  });

  it('shows captions in their window and the latest one wins', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.until(250);
    expect(sim.view.caption).toEqual({ text: 'First', key: 0 });
    sim.until(sim.tr.steps[0].capTo + 20);
    expect(sim.view.caption).toBeNull();
  });

  it('types text progressively, masked when asked', () => {
    const tr = trace({ steps: [
      { type: 'type', target: { sel: '#a' }, text: 'abcdefgh', t: 500 },
      { type: 'type', target: { sel: '#b' }, text: 'secret', t: 3000, mask: true },
    ] });
    const sim = new Sim(tr, { 0: A, 1: B }).play();
    sim.until(480);
    expect(sim.view.chip).toBeNull();
    sim.until(500 + (tr.end[0] - tr.at[0]) / 2);
    expect(sim.view.chip!.length).toBeGreaterThanOrEqual(3);
    expect(sim.view.chip!.length).toBeLessThanOrEqual(6);
    expect('abcdefgh'.startsWith(sim.view.chip!)).toBe(true);
    sim.until(tr.end[1] - 1);
    expect(sim.view.chip).toMatch(/^•+$/);
  });

  it('shows key chips', () => {
    const tr = trace({ steps: [{ type: 'key', keys: 'Mod+Enter', t: 500 }] });
    const sim = new Sim(tr).play();
    sim.until(550);
    expect(sim.view.chip).toBe('⌘↵');
    sim.cfg = { ...CFG, mac: false };
    expect(sim.view.chip).toBe('Ctrl+Enter');
  });

  it('reports the step index and count', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    expect(sim.view).toMatchObject({ index: 0, count: 2, phase: 'playing' });
  });

  it('is pure: same state, same view', () => {
    const sim = new Sim(twoClicks(), { 0: A, 1: B }).play();
    sim.run(700);
    expect(view(sim.s, sim.tr, sim.look, CFG)).toEqual(view(sim.s, sim.tr, sim.look, CFG));
  });
});

describe('formatKeys', () => {
  it('names keys for Mac and others', () => {
    expect(formatKeys('Mod+Shift+K', true)).toBe('⌘⇧K');
    expect(formatKeys('Mod+Shift+K', false)).toBe('Ctrl+Shift+K');
    expect(formatKeys('alt + tab', false)).toBe('Alt+Tab');
    expect(formatKeys('Escape', true)).toBe('Esc');
    expect(formatKeys('ArrowDown', false)).toBe('↓');
    expect(formatKeys('F5', true)).toBe('F5');
    expect(formatKeys('a', true)).toBe('A');
  });
});

describe('properties', () => {
  const look = fc.option(fc.record({ x: fc.integer({ min: -200, max: 2000 }), y: fc.integer({ min: -200, max: 2000 }), w: fc.integer({ min: 0, max: 300 }), h: fc.integer({ min: 0, max: 300 }), inView: fc.boolean() }), { nil: null });
  const step = fc.oneof(
    fc.record({ type: fc.constantFrom('click', 'move', 'hover', 'dblclick'), target: fc.constant({ sel: '#x' }) }),
    fc.record({ type: fc.constant('type'), target: fc.constant({ sel: '#x' }), text: fc.string({ maxLength: 20 }) }),
    fc.record({ type: fc.constant('note'), say: fc.string({ minLength: 1, maxLength: 30 }) }),
    fc.record({ type: fc.constant('key'), keys: fc.constantFrom('Enter', 'Mod+K') }),
    fc.record({ type: fc.constant('scroll'), by: fc.constant({ y: 100 }) }),
    fc.record({ type: fc.constant('wait'), target: fc.constant({ sel: '#x' }), timeout: fc.integer({ min: 0, max: 300 }) }),
  );
  const timed = fc.tuple(step, fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }), fc.boolean(), fc.option(fc.string({ maxLength: 20 }), { nil: undefined }))
    .map(([s, t, pause, say]) => ({ ...s, ...(t === undefined ? {} : { t }), pause, ...(say ? { say } : {}) }));
  const msg = fc.oneof(
    fc.constant({ kind: 'frame' as const }), fc.constant({ kind: 'frame' as const }), fc.constant({ kind: 'frame' as const }),
    fc.constantFrom({ kind: 'play' as const }, { kind: 'pause' as const }, { kind: 'toggle' as const }, { kind: 'stop' as const }, { kind: 'next' as const }, { kind: 'prev' as const }, { kind: 'takeover' as const }),
    fc.integer({ min: -100, max: 20_000 }).map((t) => ({ kind: 'seek' as const, t })),
    fc.double({ min: 0.1, max: 8, noNaN: true }).map((r) => ({ kind: 'rate' as const, r })),
  );

  it('any trace, any commands: never throws, time stays in range, cursor stays finite', () => {
    fc.assert(fc.property(fc.array(timed, { minLength: 1, maxLength: 8 }), fc.array(look, { minLength: 8, maxLength: 8 }), fc.array(msg, { maxLength: 80 }), fc.boolean(), (steps, looks, msgs, reduced) => {
      const tr = trace({ steps: steps as never, path: null });
      const table: Record<number, Look | null> = {};
      looks.forEach((l, i) => { table[i] = l ? { ...l, by: 'sel' } : null; });
      let s = initial();
      let now = 0;
      const cfg = { ...CFG, reducedMotion: reduced };
      for (const m of msgs) {
        if (m.kind === 'frame') { now += 40; [s] = update(s, { kind: 'frame', now, look: (i) => table[i] ?? null, vp: { w: 1280, h: 800 } }, tr, cfg); }
        else [s] = update(s, m, tr, cfg);
        if (s.clock.elapsed < 0 || s.clock.elapsed > tr.duration + 1e-6) return false;
        if (s.i < 0 || s.i >= tr.steps.length) return false;
        if (s.pos && !(Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y))) return false;
        const v = view(s, tr, (i) => table[i] ?? null, cfg);
        if (v.cursor.visible && !Number.isFinite(v.cursor.x)) return false;
      }
      return true;
    }), { numRuns: 300 });
  });

  it('playing straight through fires each step exactly once, in order', () => {
    fc.assert(fc.property(fc.array(timed, { minLength: 1, maxLength: 10 }), (steps) => {
      const tr = trace({ steps: steps.map((s) => ({ ...s, pause: false })) as never });
      const table: Record<number, Look> = {};
      tr.steps.forEach((_, i) => { table[i] = box(i * 10, i * 10); });
      const sim = new Sim(tr, table).play();
      sim.until(1e9, 33, 20_000);
      const fired = sim.fx.filter((f) => f.fx === 'step').map((f) => (f as { i: number }).i);
      return sim.s.phase === 'ended' && JSON.stringify(fired) === JSON.stringify(tr.steps.map((_, i) => i));
    }), { numRuns: 150 });
  });
});

describe('pages', () => {
  const paged = () => trace({ steps: [
    { type: 'click', target: { sel: '#a' }, t: 1000, page: '/app' },
    { type: 'click', target: { sel: '#b' }, t: 2000, page: '/app/tasks/*' },
  ] });

  it('on the wrong page it waits without searching, says where to go, and never gives up', () => {
    const sim = new Sim(paged(), { 0: A, 1: B });
    sim.at = '/app/tasks/new';
    sim.play();
    expect(sim.s.phase).toBe('waiting');
    expect(sim.fx).toContainEqual({ fx: 'page', i: 0, want: '/app' });
    expect(sim.view.caption).toEqual({ text: 'Open /app to continue', key: -1000 });
    const calls = sim.lookCalls;
    sim.run(60_000);
    expect(sim.s.phase).toBe('waiting');
    expect(sim.kinds()).not.toContain('stalled');
    expect(sim.fx.filter((f) => f.fx === 'page')).toHaveLength(1);
    expect(sim.lookCalls).toBe(calls); // the wrong page is never searched
    sim.at = '/app';
    sim.run(100);
    expect(sim.s.phase).toBe('playing');
  });

  it('waits again mid-trace when the next step is on another page, then carries on when the viewer gets there', () => {
    const sim = new Sim(paged(), { 0: A, 1: B });
    sim.at = '/app';
    sim.play();
    sim.until(1300);
    expect(sim.fx).toContainEqual({ fx: 'step', i: 0, by: 'sel' });
    expect(sim.s.phase).toBe('waiting');
    expect(sim.fx).toContainEqual({ fx: 'page', i: 1, want: '/app/tasks/*' });
    expect(sim.view.caption?.text).toBe('Open /app/tasks/… to continue');
    expect(sim.view.cursor).toMatchObject({ visible: true, x: 150, y: 120 }); // stays on the last element
    sim.at = '/app/tasks/bfd02a18';
    sim.run(50);
    sim.until(99_999);
    expect(sim.fx).toContainEqual({ fx: 'step', i: 1, by: 'sel' });
    expect(sim.s.phase).toBe('ended');
  });

  it('an element that looks right on the wrong page is not used', () => {
    const sim = new Sim(paged(), { 0: A, 1: B });
    sim.at = '/app';
    sim.play();
    sim.until(1300);
    // B "exists" here too (same selector on the overview), but step 1 belongs to a task page.
    expect(sim.s.phase).toBe('waiting');
    expect(sim.fx.filter((f) => f.fx === 'step').map((f) => (f as { i: number }).i)).toEqual([0]);
  });

  it('without a known page, or for steps without one, nothing changes', () => {
    const a = new Sim(paged(), { 0: A, 1: B }).play();
    a.until(99_999);
    expect(a.kinds()).not.toContain('page');
    expect(a.s.phase).toBe('ended');
    const b = new Sim(twoClicks(), { 0: A, 1: B });
    b.at = '/anything';
    b.play();
    b.until(99_999);
    expect(b.kinds()).not.toContain('page');
  });

  it('catches up when the viewer has gone ahead: jumps to the first later step on their page', () => {
    const tr = trace({ steps: [
      { type: 'click', target: { sel: '#a' }, t: 1000, page: '/app' },
      { type: 'click', target: { sel: '#b' }, t: 2000, page: '/app/tasks/new' },
      { type: 'click', target: { sel: '#c' }, t: 3000 },
      { type: 'click', target: { sel: '#d' }, t: 4000, page: '/app/tasks/*/run' },
    ] });
    const D = box(300, 300);
    const sim = new Sim(tr, { 0: A, 1: B, 2: B, 3: D });
    sim.at = '/app';
    sim.play();
    sim.until(1300);
    expect(sim.s.phase).toBe('waiting'); // step 1 wants /app/tasks/new; still on /app = not moved yet
    sim.run(500);
    expect([sim.s.phase, sim.s.i]).toEqual(['waiting', 1]);
    sim.at = '/elsewhere'; // left, but not for a page the trace knows
    sim.run(50);
    expect([sim.s.phase, sim.s.i]).toEqual(['waiting', 1]);
    sim.at = '/app/tasks/42/run'; // ahead of the guide
    sim.run(50);
    expect(sim.s.i).toBe(3);
    sim.until(99_999);
    expect(sim.fx.filter((f) => f.fx === 'step').map((f) => (f as { i: number }).i)).toEqual([0, 3]);
    expect(sim.s.phase).toBe('ended');
  });

  it('never skips the start, and catching up wins over asking (no navigate back)', () => {
    const tr = trace({ steps: [
      { type: 'note', say: 'a', t: 0, page: '/one' },
      { type: 'note', say: 'b', t: 3000, page: '/two' },
      { type: 'note', say: 'c', t: 6000, page: '/three' },
    ] });
    const start = new Sim(tr);
    start.at = '/three';
    start.play();
    start.run(50);
    expect([start.s.phase, start.s.i]).toEqual(['waiting', 0]);
    const sim = new Sim(tr);
    sim.at = '/one';
    sim.play();
    sim.run(1000);
    sim.at = '/three';
    sim.until(99_999);
    expect(sim.fx.filter((f) => f.fx === 'page')).toEqual([]);
    expect(sim.fx.filter((f) => f.fx === 'step').map((f) => (f as { i: number }).i)).toEqual([0, 2]);
  });
});
