/**
 * Recorder lifecycle: idle → recording ⇄ paused → stopped (and start again).
 * PURE.
 */

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecorderAction = 'start' | 'pause' | 'resume' | 'stop';

const T: Record<RecorderState, Partial<Record<RecorderAction, RecorderState>>> = {
  idle: { start: 'recording' },
  recording: { pause: 'paused', stop: 'stopped' },
  paused: { resume: 'recording', stop: 'stopped' },
  stopped: { start: 'recording' },
};

/** The next state, or the same state when the action does not apply. */
export function next(state: RecorderState, action: RecorderAction): RecorderState {
  return T[state][action] ?? state;
}

/** Recording time that leaves out paused stretches. */
export interface RecClock { start: number; pausedTotal: number; pausedAt: number | null }

export const recClock = (now: number): RecClock => ({ start: now, pausedTotal: 0, pausedAt: null });
export const recPause = (c: RecClock, now: number): RecClock => (c.pausedAt === null ? { ...c, pausedAt: now } : c);
export const recResume = (c: RecClock, now: number): RecClock => (c.pausedAt === null ? c : { ...c, pausedTotal: c.pausedTotal + (now - c.pausedAt), pausedAt: null });
export const recElapsed = (c: RecClock, now: number): number => Math.max(0, (c.pausedAt ?? now) - c.start - c.pausedTotal);
