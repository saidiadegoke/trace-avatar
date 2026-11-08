import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as C from '../../src/core/clock';
import { curvePoint, ease, rand, samplePath, simplify } from '../../src/core/motion';

describe('clock', () => {
  it('starts at zero with no wall time', () => {
    expect(C.clock()).toEqual({ elapsed: 0, rate: 1, last: null });
    expect(C.clock(2).rate).toBe(2);
  });

  it('adds nothing on the first tick, then wall time × rate', () => {
    let c = C.tick(C.clock(), 1000);
    expect(c).toEqual({ elapsed: 0, rate: 1, last: 1000 });
    c = C.tick(c, 1016);
    expect(c.elapsed).toBe(16);
    c = C.tick(C.setRate(c, 2), 1032);
    expect(c.elapsed).toBe(48);
  });

  it('caps one tick at MAX_GAP and ignores time going backwards', () => {
    const c = C.tick(C.tick(C.clock(), 0), 5000);
    expect(c.elapsed).toBe(C.MAX_GAP);
    expect(C.tick({ elapsed: 10, rate: 1, last: 100 }, 50).elapsed).toBe(10);
  });

  it('stop keeps elapsed and resumes without a jump', () => {
    let c = C.tick(C.tick(C.clock(), 0), 50);
    c = C.stop(c);
    expect(c).toEqual({ elapsed: 50, rate: 1, last: null });
    expect(C.stop(c)).toBe(c);
    c = C.tick(c, 9999);
    expect(c.elapsed).toBe(50);
    expect(C.tick(c, 10_009).elapsed).toBe(60);
  });

  it('hold notes wall time without adding', () => {
    const c = C.hold({ elapsed: 5, rate: 1, last: 0 }, 900);
    expect(c).toEqual({ elapsed: 5, rate: 1, last: 900 });
  });

  it('seek sets elapsed (never negative) and clears wall time', () => {
    expect(C.seek({ elapsed: 5, rate: 3, last: 9 }, 400)).toEqual({ elapsed: 400, rate: 3, last: null });
    expect(C.seek(C.clock(), -5).elapsed).toBe(0);
  });

  it('setRate clamps to 0.25–4', () => {
    expect(C.setRate(C.clock(), 10).rate).toBe(4);
    expect(C.setRate(C.clock(), 0).rate).toBe(0.25);
    expect(C.setRate(C.clock(), 1.5).rate).toBe(1.5);
  });
});

describe('rand / ease', () => {
  it('rand is deterministic and in [0, 1)', () => {
    expect(rand(42)).toBe(rand(42));
    expect(rand(1)).not.toBe(rand(2));
    fc.assert(fc.property(fc.integer(), (s) => { const r = rand(s); return r >= 0 && r < 1; }));
  });

  it('ease runs 0 → 1, monotonic, symmetric around the middle', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => (a <= b ? ease(a) <= ease(b) + 1e-12 : true)));
    expect(ease(0.2) + ease(0.8)).toBeCloseTo(1);
  });
});

describe('curvePoint', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 400, y: 200 };

  it('starts at from and ends at to', () => {
    expect(curvePoint(from, to, 0, 1, { x: 9, y: 9 })).toEqual(from);
    expect(curvePoint(from, to, -1, 1, { x: 9, y: 9 })).toEqual(from);
    expect(curvePoint(from, to, 1, 1, { x: 9, y: 9 })).toEqual(to);
    expect(curvePoint(from, to, 2, 1, { x: 9, y: 9 })).toEqual(to);
  });

  it('jumps when the points (almost) coincide', () => {
    expect(curvePoint(from, { x: 0.5, y: 0 }, 0.5, 1, { x: 0, y: 0 })).toEqual({ x: 0.5, y: 0 });
  });

  it('writes into and returns `out`', () => {
    const out = { x: 0, y: 0 };
    expect(curvePoint(from, to, 0.5, 1, out)).toBe(out);
  });

  it('is deterministic for a seed and bends differently for different seeds', () => {
    const a = curvePoint(from, to, 0.5, 7, { x: 0, y: 0 });
    const b = curvePoint(from, to, 0.5, 7, { x: 0, y: 0 });
    expect(a).toEqual(b);
    const offsets = new Set(Array.from({ length: 20 }, (_, s) => Math.round(curvePoint(from, to, 0.5, s, { x: 0, y: 0 }).x)));
    expect(offsets.size).toBeGreaterThan(3);
  });

  it('stays close to the straight line (bend ≤ 15% of the distance) and moves forward', () => {
    const d = Math.hypot(400, 200);
    fc.assert(fc.property(fc.integer({ min: 0, max: 10_000 }), fc.double({ min: 0, max: 1, noNaN: true }), (seed, u) => {
      const p = curvePoint(from, to, u, seed, { x: 0, y: 0 });
      const dist = Math.abs(to.x * p.y - to.y * p.x) / d; // distance from the line through from/to
      return dist <= 0.15 * d + 1e-6;
    }));
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const p = curvePoint(from, to, Math.min(u, 1), 3, { x: 0, y: 0 });
      const along = (p.x * to.x + p.y * to.y) / d;
      expect(along).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = along;
    }
  });

  it('follows the easing curve along the path length', () => {
    const p = curvePoint({ x: 0, y: 0 }, { x: 1000, y: 0 }, 0.25, 5, { x: 0, y: 0 });
    // Arc length at u is ease(u) × total, and the bend makes the total a bit longer than 1000.
    expect(p.x).toBeGreaterThan(ease(0.25) * 1000 * 0.9);
    expect(p.x).toBeLessThan(ease(0.25) * 1000 * 1.1);
  });
});

describe('samplePath', () => {
  const path = new Float32Array([0, 0, 0, 100, 100, 50, 200, 100, 150]);
  const at = (t: number, sx = 1, sy = 1) => samplePath(path, t, sx, sy, { x: -1, y: -1 });

  it('interpolates between neighbours', () => {
    expect(at(50)).toEqual({ x: 50, y: 25 });
    expect(at(150)).toEqual({ x: 100, y: 100 });
    expect(at(100)).toEqual({ x: 100, y: 50 });
  });
  it('clamps before the first and after the last sample', () => {
    expect(at(-10)).toEqual({ x: 0, y: 0 });
    expect(at(999)).toEqual({ x: 100, y: 150 });
  });
  it('scales to the current viewport', () => {
    expect(at(100, 0.5, 2)).toEqual({ x: 50, y: 100 });
  });
  it('leaves out untouched for an empty path, and handles equal times', () => {
    expect(samplePath(new Float32Array(0), 5, 1, 1, { x: 7, y: 8 })).toEqual({ x: 7, y: 8 });
    expect(samplePath(new Float32Array([0, 1, 1, 10, 2, 2, 10, 3, 3, 20, 4, 4]), 10, 1, 1, { x: 0, y: 0 }).x).toBeGreaterThanOrEqual(2);
  });
});

describe('simplify', () => {
  it('keeps short paths as they are', () => {
    expect(Array.from(simplify([0, 1, 1, 5, 2, 2]))).toEqual([0, 1, 1, 5, 2, 2]);
  });

  it('drops samples on a steady straight line, keeping the ends', () => {
    const line: number[] = [];
    for (let i = 0; i <= 10; i += 1) line.push(i * 10, i * 10, 0);
    expect(Array.from(simplify(line))).toEqual([0, 0, 0, 100, 100, 0]);
  });

  it('keeps a corner', () => {
    const p = [0, 0, 0, 10, 50, 0, 20, 100, 0, 30, 100, 50, 40, 100, 100];
    const out = Array.from(simplify(p));
    expect(out).toContain(100);
    expect(out.length / 3).toBe(3);
    expect(out.slice(3, 6)).toEqual([20, 100, 0]);
  });

  it('keeps a hesitation that geometric RDP would drop', () => {
    // Move to x=50, rest there for 1s, then carry on to x=100: all on one line.
    const p = [0, 0, 0, 100, 50, 0, 1100, 50, 0, 1200, 100, 0];
    const out = Array.from(simplify(p));
    expect(out.length / 3).toBe(4);
  });

  it('respects the tolerance', () => {
    const p = [0, 0, 0, 10, 50, 1.5, 20, 100, 0];
    expect(simplify(p, 2).length / 3).toBe(2);
    expect(simplify(p, 1).length / 3).toBe(3);
  });

  it('never moves a kept sample and never reorders time', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 500 })), { minLength: 3, maxLength: 60 }), (pts) => {
      const flat = pts.flatMap(([x, y], i) => [i * 16, x, y]);
      const out = simplify(flat, 2);
      for (let i = 0; i + 3 < out.length; i += 3) if (out[i] >= out[i + 3]) return false;
      return out[0] === 0 && out[out.length - 3] === (pts.length - 1) * 16;
    }));
  });
});
