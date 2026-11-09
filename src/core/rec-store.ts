/**
 * Recording across page loads: what the recorder keeps in sessionStorage between pages, and how
 * its clock carries on. PURE.
 *
 * Text in the drafts is already masked when it is captured, so nothing secret is stored.
 */

import type { Draft } from './build';
import type { RecClock } from './recorder-state';

export interface SavedRecording {
  v: 1;
  state: 'recording' | 'paused';
  /** Recording time (pauses excluded) when it was saved. */
  elapsed: number;
  /** Wall clock (ms) when it was saved. */
  savedAt: number;
  origin: string;
  drafts: Draft[];
  /** Pointer samples, interleaved [t, x, y], the last REC_PATH_MS only. */
  path: number[];
  startUrl?: string;
  touches: number;
  pointers: number;
  /** The author left for another site (a sign-in) and came back. */
  signin?: boolean;
}

/** A saved recording older than this is dropped. */
export const REC_PERSIST_MS = 30 * 60_000;
/** How much pointer path survives a page load. */
export const REC_PATH_MS = 120_000;

/** The pointer samples from the last keepMs before `elapsed`, rounded to whole numbers. */
export function trimPath(path: ArrayLike<number>, elapsed: number, keepMs: number = REC_PATH_MS): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < path.length; i += 3) {
    if (path[i] >= elapsed - keepMs) out.push(Math.round(path[i]), Math.round(path[i + 1]), Math.round(path[i + 2]));
  }
  return out;
}

const DRAFT_KINDS = new Set(['click', 'dblclick', 'type', 'key', 'scroll', 'note']);

/** Whether a stored value is a saved recording that may be carried on at wall time `now`. */
export function savedOk(v: unknown, now: number, maxAge: number = REC_PERSIST_MS): v is SavedRecording {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<SavedRecording>;
  return s.v === 1 && (s.state === 'recording' || s.state === 'paused')
    && typeof s.elapsed === 'number' && s.elapsed >= 0
    && typeof s.savedAt === 'number' && now - s.savedAt >= 0 && now - s.savedAt < maxAge
    && typeof s.origin === 'string'
    && Array.isArray(s.drafts) && s.drafts.every((d) => !!d && typeof d === 'object' && DRAFT_KINDS.has((d as Draft).kind) && typeof (d as Draft).t === 'number')
    && Array.isArray(s.path) && s.path.length % 3 === 0 && s.path.every((n) => typeof n === 'number')
    && typeof s.touches === 'number' && typeof s.pointers === 'number';
}

/** Recording time now: a running recording counts the time the page took to load (a gap, squeezed later). */
export function resumeElapsed(s: SavedRecording, now: number): number {
  return s.state === 'recording' ? s.elapsed + Math.max(0, now - s.savedAt) : s.elapsed;
}

/** A recorder clock reading `elapsed` at monotonic time `at`, paused or running. */
export function clockAt(at: number, elapsed: number, paused: boolean): RecClock {
  return { start: at - elapsed, pausedTotal: 0, pausedAt: paused ? at : null };
}

/** The page was reached from another site (by the referrer's origin). */
export function cameFromElsewhere(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try { return new URL(referrer).origin !== origin; } catch { return false; }
}

/** The step a recording gets when the author went to another site (to sign in) and came back. */
export const SIGN_IN_NOTE = 'Sign in, then press play.';
