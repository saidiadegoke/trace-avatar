/**
 * Where the cursor is between two points. Pure geometry; randomness comes only
 * from a seed, so the same trace and seed always draw the same paths.
 *
 * PURE. The hot functions write into an `out` point and a module scratch
 * buffer, so a frame allocates nothing here.
 */

import type { Point } from './format';

/** mulberry32, one step: a float in [0, 1) from an integer seed. */
export function rand(seed: number): number {
  let a = (seed | 0) + 0x6d2b79f5;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Ease in and out (cubic). */
export const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

const SEGMENTS = 16;
const lut = new Float32Array(SEGMENTS + 1);

function bez(p0: number, p1: number, p2: number, p3: number, s: number): number {
  const m = 1 - s;
  return m * m * m * p0 + 3 * m * m * s * p1 + 3 * m * s * s * p2 + s * s * s * p3;
}

/**
 * A point on a gently curved path from `from` to `to`.
 * `u` is the share of the travel time (0..1); easing and an arc-length table
 * make the speed follow the easing curve, not the curve's shape.
 */
export function curvePoint(from: Point, to: Point, u: number, seed: number, out: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (u <= 0) { out.x = from.x; out.y = from.y; return out; }
  if (u >= 1 || d < 1) { out.x = to.x; out.y = to.y; return out; }
  // Bend sideways by 5–15% of the distance, to a seeded side; the second control point bends less.
  const k = (0.05 + rand(seed) * 0.1) * (rand(seed + 7919) < 0.5 ? -1 : 1) * d;
  const nx = -dy / d;
  const ny = dx / d;
  const c1x = from.x + dx * 0.3 + nx * k;
  const c1y = from.y + dy * 0.3 + ny * k;
  const c2x = from.x + dx * 0.7 + nx * k * 0.6;
  const c2y = from.y + dy * 0.7 + ny * k * 0.6;

  // Arc-length table.
  let px = from.x;
  let py = from.y;
  lut[0] = 0;
  for (let j = 1; j <= SEGMENTS; j += 1) {
    const s = j / SEGMENTS;
    const x = bez(from.x, c1x, c2x, to.x, s);
    const y = bez(from.y, c1y, c2y, to.y, s);
    lut[j] = lut[j - 1] + Math.hypot(x - px, y - py);
    px = x; py = y;
  }
  const want = ease(u) * lut[SEGMENTS];
  let j = 1;
  while (j < SEGMENTS && lut[j] < want) j += 1;
  const segLen = lut[j] - lut[j - 1];
  const s = (j - 1 + (segLen > 0 ? (want - lut[j - 1]) / segLen : 0)) / SEGMENTS;
  out.x = bez(from.x, c1x, c2x, to.x, s);
  out.y = bez(from.y, c1y, c2y, to.y, s);
  return out;
}

/**
 * The recorded pointer position at time t, from an interleaved [t, x, y, …]
 * path (binary search on t, linear between neighbours), scaled by `sx, sy`.
 */
export function samplePath(path: Float32Array, t: number, sx: number, sy: number, out: Point): Point {
  const n = path.length / 3;
  if (n === 0) return out;
  if (t <= path[0]) { out.x = path[1] * sx; out.y = path[2] * sy; return out; }
  const lastI = (n - 1) * 3;
  if (t >= path[lastI]) { out.x = path[lastI + 1] * sx; out.y = path[lastI + 2] * sy; return out; }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid * 3] <= t) lo = mid; else hi = mid;
  }
  const a = lo * 3;
  const b = hi * 3;
  const span = path[b] - path[a];
  const f = span > 0 ? (t - path[a]) / span : 0;
  out.x = (path[a + 1] + (path[b + 1] - path[a + 1]) * f) * sx;
  out.y = (path[a + 2] + (path[b + 2] - path[a + 2]) * f) * sy;
  return out;
}

/**
 * Ramer–Douglas–Peucker on an interleaved [t, x, y] path, keeping first and last samples.
 *
 * Distance is time-synchronised: a sample is compared with where straight-line
 * playback between the kept neighbours would put the cursor *at that sample's
 * time*. So hesitations (the pointer resting, then moving on) survive, which
 * plain geometric RDP would flatten away.
 */
export function simplify(path: ArrayLike<number>, tolerance = 2): Float32Array {
  const n = Math.floor(path.length / 3);
  if (n <= 2) return Float32Array.from(path as ArrayLike<number>);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const at = path[a * 3]; const ax = path[a * 3 + 1]; const ay = path[a * 3 + 2];
    const bt = path[b * 3]; const bx = path[b * 3 + 1]; const by = path[b * 3 + 2];
    const span = bt - at;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i += 1) {
      const f = span > 0 ? (path[i * 3] - at) / span : 0;
      const ex = ax + (bx - ax) * f;
      const ey = ay + (by - ay) * f;
      const d2 = (path[i * 3 + 1] - ex) ** 2 + (path[i * 3 + 2] - ey) ** 2;
      if (d2 > bestD) { bestD = d2; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push(a, best, best, b); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(path[i * 3], path[i * 3 + 1], path[i * 3 + 2]);
  return Float32Array.from(out);
}
