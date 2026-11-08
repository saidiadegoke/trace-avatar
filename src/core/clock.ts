/**
 * The clock is a value, not a timer. It accumulates trace time from the wall
 * time it is handed, so pausing, rate changes and holds just stop or scale the
 * adding — there is no start-time arithmetic to get wrong.
 *
 * PURE.
 */

export interface Clock {
  /** Trace time, ms. */
  readonly elapsed: number;
  /** Playback speed, 0.25–4. */
  readonly rate: number;
  /** Wall time of the last tick; null while stopped (the next tick adds nothing). */
  readonly last: number | null;
}

/** Longest wall-time gap one tick may add: a background tab or a breakpoint must not teleport the cursor. */
export const MAX_GAP = 100;

export const clock = (rate = 1): Clock => ({ elapsed: 0, rate, last: null });

/** Advance by the wall time since the last tick (scaled by rate, capped). */
export function tick(c: Clock, now: number): Clock {
  const dt = c.last === null ? 0 : Math.min(Math.max(now - c.last, 0), MAX_GAP) * c.rate;
  return { elapsed: c.elapsed + dt, rate: c.rate, last: now };
}

/** Note the wall time without adding any (used while holding). */
export const hold = (c: Clock, now: number): Clock => ({ ...c, last: now });

/** Stop adding; elapsed is kept, so resuming continues from the same place. */
export const stop = (c: Clock): Clock => (c.last === null ? c : { ...c, last: null });

export const seek = (c: Clock, t: number): Clock => ({ elapsed: Math.max(0, t), rate: c.rate, last: null });

export const setRate = (c: Clock, r: number): Clock => ({ ...c, rate: Math.min(4, Math.max(0.25, r)) });
