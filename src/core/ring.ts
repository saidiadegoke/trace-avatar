/**
 * A fixed-capacity ring buffer of [t, x, y] samples in one Float32Array.
 * Memory stays fixed however long a recording runs; when full, the oldest
 * samples are dropped and counted.
 *
 * PURE (no DOM). Mutable by design: it is the recorder's hot path.
 */

export interface Ring {
  push(t: number, x: number, y: number): void;
  /** Samples oldest → newest, interleaved [t, x, y, …]. */
  toArray(): Float32Array;
  readonly size: number;
  readonly dropped: number;
  readonly capacity: number;
  clear(): void;
}

export function ring(capacity: number): Ring {
  if (!(capacity >= 1)) throw new RangeError('ring capacity must be at least 1');
  const cap = Math.floor(capacity);
  const buf = new Float32Array(cap * 3);
  let head = 0; // next write slot
  let size = 0;
  let dropped = 0;
  return {
    push(t, x, y) {
      const k = head * 3;
      buf[k] = t; buf[k + 1] = x; buf[k + 2] = y;
      head = (head + 1) % cap;
      if (size < cap) size += 1; else dropped += 1;
    },
    toArray() {
      const out = new Float32Array(size * 3);
      const start = (head - size + cap) % cap;
      for (let i = 0; i < size; i += 1) {
        const from = ((start + i) % cap) * 3;
        out[i * 3] = buf[from]; out[i * 3 + 1] = buf[from + 1]; out[i * 3 + 2] = buf[from + 2];
      }
      return out;
    },
    get size() { return size; },
    get dropped() { return dropped; },
    get capacity() { return cap; },
    clear() { head = 0; size = 0; dropped = 0; },
  };
}
