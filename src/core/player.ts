/**
 * The player: an explicit state machine written as a reducer.
 *
 *   update(state, msg, trace, config) → [state', effects[]]
 *   view(state, trace, look, config)  → View
 *
 * `update` never touches the page. It returns the next state and a list of
 * effects as data (ripple here, scroll that element, emit "step"), which the
 * shell carries out. Page facts come in through `look(i)`, a read-only query
 * the shell answers from one layout read per frame.
 *
 * PURE.
 */

import * as C from './clock';
import type { Clock } from './clock';
import { labelOf, lastAtOrBefore, stepAt } from './format';
import type { NStep, NormalisedTrace, Point } from './format';
import { curvePoint, samplePath } from './motion';

export type Phase = 'idle' | 'playing' | 'paused' | 'waiting' | 'ended';
export type PauseReason = 'user' | 'takeover' | 'pause-step';
export type ResolvedBy = 'sel' | 'role' | 'text' | 'xy';

/** What the shell measured about a step's element this frame (viewport pixels). */
export interface Look { x: number; y: number; w: number; h: number; by: ResolvedBy; inView: boolean }
export type LookFn = (i: number) => Look | null;
export interface Viewport { w: number; h: number }

export interface Config {
  reducedMotion: boolean;
  loop: boolean;
  /** Show ⌘-style key names. */
  mac: boolean;
  /** When the viewer takes over, say how to resume (only useful when controls are shown). */
  resumeHint?: boolean;
}

interface Leg { readonly i: number; readonly from: Point | null; readonly t0: number }

interface Common {
  readonly clock: Clock;
  /** The active step: the first whose end is after the current time. */
  readonly i: number;
  /** Highest step index whose action has happened. */
  readonly fired: number;
  /** Highest pause-step already paused at (so resuming does not pause again). */
  readonly pausedAt: number;
  /** Highest step whose element was scrolled into view. */
  readonly revealed: number;
  /** A step whose element never appeared; it plays without one. */
  readonly gaveUp: number;
  readonly leg: Leg;
  readonly pos: Point | null;
  readonly pressed: boolean;
}

export type PlayerState = Common & (
  | { readonly phase: 'idle' }
  | { readonly phase: 'playing' }
  | { readonly phase: 'paused'; readonly why: PauseReason }
  | { readonly phase: 'waiting'; readonly since: number; readonly for: 'target' | 'wait-step' }
  | { readonly phase: 'ended' }
);

export type Msg =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'toggle' }
  | { kind: 'stop' }
  | { kind: 'seek'; t: number }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'rate'; r: number }
  | { kind: 'takeover' }
  | { kind: 'frame'; now: number; look: LookFn; vp: Viewport };

export type Effect =
  | { fx: 'step'; i: number; by: ResolvedBy | null }
  | { fx: 'ripple'; x: number; y: number }
  | { fx: 'reveal'; i: number }
  | { fx: 'scroll'; i: number }
  | { fx: 'stalled'; i: number; reason: 'not-found' | 'wait-timeout' }
  | { fx: 'end' };

export interface View {
  phase: Phase;
  cursor: { x: number; y: number; pressed: boolean; visible: boolean };
  ring: { x: number; y: number; w: number; h: number } | null;
  /** `key` changes whenever the caption is a different one, so screen readers re-announce. */
  caption: { text: string; key: number } | null;
  chip: string | null;
  index: number;
  count: number;
}

const NONE: Effect[] = [];

export function initial(rate = 1): PlayerState {
  return {
    phase: 'idle',
    clock: C.clock(rate),
    i: 0,
    fired: -1,
    pausedAt: -1,
    revealed: -1,
    gaveUp: -1,
    leg: { i: 0, from: null, t0: 0 },
    pos: null,
    pressed: false,
  };
}

const common = (s: PlayerState): Common => ({
  clock: s.clock, i: s.i, fired: s.fired, pausedAt: s.pausedAt, revealed: s.revealed, gaveUp: s.gaveUp, leg: s.leg, pos: s.pos, pressed: s.pressed,
});

const paused = (s: Common, why: PauseReason): PlayerState => ({ ...s, clock: C.stop(s.clock), phase: 'paused', why });

/** The point on a step's element the cursor aims at. */
export function pointOf(l: Look, step: NStep): Point {
  const rx = step.target?.at?.rx ?? 0.5;
  const ry = step.target?.at?.ry ?? 0.5;
  return { x: l.x + l.w * rx, y: l.y + l.h * ry };
}

export function update(s: PlayerState, m: Msg, tr: NormalisedTrace, cfg: Config): [PlayerState, Effect[]] {
  switch (m.kind) {
    case 'play':
      if (s.phase === 'idle' || s.phase === 'ended') return [{ ...initial(s.clock.rate), phase: 'playing' }, NONE];
      if (s.phase === 'paused') return [{ ...common(s), clock: C.stop(s.clock), leg: { i: s.i, from: s.pos, t0: s.clock.elapsed }, phase: 'playing' }, NONE];
      return [s, NONE];
    case 'pause':
      return s.phase === 'playing' || s.phase === 'waiting' ? [paused(common(s), 'user'), NONE] : [s, NONE];
    case 'toggle':
      return update(s, { kind: s.phase === 'playing' || s.phase === 'waiting' ? 'pause' : 'play' }, tr, cfg);
    case 'takeover':
      return s.phase === 'playing' || s.phase === 'waiting' ? [paused(common(s), 'takeover'), NONE] : [s, NONE];
    case 'stop':
      return [initial(s.clock.rate), NONE];
    case 'rate':
      return [{ ...s, clock: C.setRate(s.clock, m.r) }, NONE];
    case 'seek':
      return [seekTo(s, m.t, tr), NONE];
    case 'next': {
      const t = s.clock.elapsed;
      const n = tr.steps.length;
      const target = t < tr.end[s.i] - 1 ? tr.end[s.i] : s.i + 1 < n ? tr.end[s.i + 1] : tr.duration;
      return [seekTo(s, target, tr), NONE];
    }
    case 'prev': {
      const t = s.clock.elapsed;
      const back = t > tr.travelStart[s.i] + 400 ? s.i - 1 : s.i - 2;
      return [seekTo(s, back >= 0 ? tr.end[back] : 0, tr), NONE];
    }
    case 'frame':
      return frame(s, m, tr, cfg);
    default: {
      const never: never = m;
      return never;
    }
  }
}

function seekTo(s: PlayerState, t: number, tr: NormalisedTrace): PlayerState {
  const tt = Math.min(Math.max(t, 0), tr.duration);
  const i = stepAt(tr, tt);
  let pausedAt = -1;
  for (let j = 0; j < tr.steps.length && tr.end[j] <= tt; j += 1) if (tr.steps[j].pause) pausedAt = j;
  const base: Common = {
    clock: C.seek(s.clock, tt),
    i,
    fired: lastAtOrBefore(tr.at, tt),
    pausedAt,
    revealed: i - 1,
    gaveUp: -1,
    leg: { i, from: null, t0: tr.travelStart[i] },
    pos: s.pos,
    pressed: false,
  };
  if (tt >= tr.duration) return { ...base, phase: 'ended' };
  if (s.phase === 'playing' || s.phase === 'waiting') return { ...base, phase: 'playing' };
  return { ...base, phase: 'paused', why: 'user' };
}

function frame(s: PlayerState, m: Extract<Msg, { kind: 'frame' }>, tr: NormalisedTrace, cfg: Config): [PlayerState, Effect[]] {
  if (s.phase === 'idle') return [s, NONE];
  const fx: Effect[] = [];
  let next: PlayerState = s;
  if (s.phase === 'playing') next = advance(s, m, tr, cfg, fx);
  else if (s.phase === 'waiting') next = waitFrame(s, m, tr, fx);
  return [withPose(next, m, tr, cfg), fx];
}

function advance(s: PlayerState, m: Extract<Msg, { kind: 'frame' }>, tr: NormalisedTrace, cfg: Config, fx: Effect[]): PlayerState {
  const c = C.tick(s.clock, m.now);
  const prevT = s.clock.elapsed;
  let t = c.elapsed;
  let { i, fired, pausedAt, revealed, leg } = s;
  const { gaveUp } = s;
  const n = tr.steps.length;
  const build = (): Common => ({ ...common(s), clock: { ...c, elapsed: t }, i, fired, pausedAt, revealed, leg });

  for (;;) {
    const st = tr.steps[i];
    if (t < st.travelStart) break;

    // Entering this step: its element must be there before the cursor sets off.
    if (st.target && gaveUp !== i && fired < i) {
      const l = m.look(i);
      if (!l) {
        t = Math.max(prevT, st.travelStart);
        return { ...build(), phase: 'waiting', since: m.now, for: st.type === 'wait' ? 'wait-step' : 'target' };
      }
      if (st.moves && revealed < i && !l.inView) { fx.push({ fx: 'reveal', i }); revealed = i; }
    }

    if (fired < i && t >= st.at) {
      fired = i;
      const l = st.target && gaveUp !== i ? m.look(i) : null;
      fx.push({ fx: 'step', i, by: l ? l.by : null });
      if ((st.type === 'click' || st.type === 'dblclick') && l) {
        const p = pointOf(l, st);
        fx.push({ fx: 'ripple', x: p.x, y: p.y });
      }
      if (st.type === 'scroll') fx.push({ fx: 'scroll', i });
    }

    if (t < st.end) break;

    if (st.pause && pausedAt < i) {
      pausedAt = i;
      t = st.end;
      return paused(build(), 'pause-step');
    }

    if (i === n - 1) {
      if (t >= tr.duration) {
        fx.push({ fx: 'end' });
        if (cfg.loop) return { ...initial(c.rate), phase: 'playing', clock: { elapsed: 0, rate: c.rate, last: m.now } };
        t = tr.duration;
        return { ...build(), phase: 'ended' };
      }
      break;
    }
    i += 1;
    leg = { i, from: null, t0: tr.travelStart[i] };
  }
  return { ...build(), phase: 'playing' };
}

function waitFrame(s: Extract<PlayerState, { phase: 'waiting' }>, m: Extract<Msg, { kind: 'frame' }>, tr: NormalisedTrace, fx: Effect[]): PlayerState {
  const st = tr.steps[s.i];
  // Keep the clock's wall time fresh so leaving the wait adds nothing for the time spent waiting.
  const clock = C.hold(s.clock, m.now);
  if (m.look(s.i)) return { ...common(s), clock, leg: { i: s.i, from: s.pos, t0: clock.elapsed }, phase: 'playing' };
  if (m.now - s.since >= st.timeout) {
    fx.push({ fx: 'stalled', i: s.i, reason: st.type === 'wait' ? 'wait-timeout' : 'not-found' });
    // Carry on without the element: the step keeps its time and caption, the cursor stays put.
    return { ...common(s), clock, gaveUp: s.i, leg: { i: s.i, from: s.pos, t0: clock.elapsed }, phase: 'playing' };
  }
  return { ...s, clock };
}

const scratch: Point = { x: 0, y: 0 };
const scratch2: Point = { x: 0, y: 0 };

function withPose(s: PlayerState, m: Extract<Msg, { kind: 'frame' }>, tr: NormalisedTrace, cfg: Config): PlayerState {
  if (s.phase === 'idle') return s;
  const step = tr.steps[s.i];
  const t = s.clock.elapsed;
  const look = m.look;

  const anchor = (j: number): Point | null => {
    const st = tr.steps[j];
    if (!st.moves || s.gaveUp === j) return null;
    const l = look(j);
    return l ? pointOf(l, st) : null;
  };

  const pinned = s.leg.i === s.i && s.leg.from ? s.leg.from : null;
  let from: Point | null = pinned;
  // A leg starts from the previous element, live (it may scroll). Without one it starts from
  // where the cursor is and that point is pinned for the rest of the leg, so it cannot drift.
  let leg = s.leg;
  if (!from && s.i > 0) from = anchor(s.i - 1);
  const own = anchor(s.i);
  const pathScale = (): [number, number] => {
    const vp = tr.meta.viewport;
    return vp ? [m.vp.w / vp.w, m.vp.h / vp.h] : [1, 1];
  };
  if (!from) {
    // Pinned now: a recorded path continues from this moment; an authored leg waits for its travel start.
    const t0 = tr.path && !cfg.reducedMotion ? t : s.leg.i === s.i ? s.leg.t0 : step.travelStart;
    from = s.pos ?? (() => {
      // First appearance: where the recording starts, or a little off the first element toward the centre.
      if (tr.path && !cfg.reducedMotion) { const [sx, sy] = pathScale(); const p = samplePath(tr.path, t0, sx, sy, { x: 0, y: 0 }); return p; }
      const aim = own ?? { x: m.vp.w / 2, y: m.vp.h / 2 };
      return { x: aim.x + (m.vp.w / 2 - aim.x) * 0.35, y: aim.y + (m.vp.h / 2 - aim.y) * 0.35 + 40 };
    })();
    leg = { i: s.i, from, t0 };
  }
  const to: Point = own ?? from;

  const legT0 = s.leg.i === s.i ? s.leg.t0 : step.travelStart;
  const t1 = step.at;
  let x: number;
  let y: number;
  if (tr.path && !cfg.reducedMotion) {
    // Recorded: follow the real pointer between actions, shifted so it leaves the previous
    // element and lands on this one wherever they are on today's page.
    const [sx, sy] = pathScale();
    const t0 = leg.from && leg.i === s.i ? leg.t0 : s.i > 0 ? tr.at[s.i - 1] : 0;
    // Steps with an element land on it; steps without one keep following the recording.
    if (own && t >= t1) { x = to.x; y = to.y; }
    else {
      const a = samplePath(tr.path, t0, sx, sy, scratch);
      const ax = from.x - a.x;
      const ay = from.y - a.y;
      let bx = ax;
      let by = ay;
      if (own) {
        const b = samplePath(tr.path, t1, sx, sy, scratch);
        bx = to.x - b.x; by = to.y - b.y;
      }
      const u = t1 > t0 ? Math.min(Math.max((t - t0) / (t1 - t0), 0), 1) : 1;
      const p = samplePath(tr.path, t, sx, sy, scratch);
      x = p.x + ax + (bx - ax) * u;
      y = p.y + ay + (by - ay) * u;
    }
  } else {
    const t0 = Math.max(step.travelStart, legT0);
    if (t >= t1 || (cfg.reducedMotion && t >= t0)) { x = to.x; y = to.y; }
    else if (t <= t0) { x = from.x; y = from.y; }
    else {
      const p = curvePoint(from, to, (t - t0) / (t1 - t0), tr.seed * 131 + s.i, scratch2);
      x = p.x; y = p.y;
    }
  }

  const since = t - step.at;
  const pressed = (step.type === 'click' || step.type === 'dblclick') && since >= 0
    && (since < 140 || (step.type === 'dblclick' && since >= 220 && since < 360));
  return { ...s, leg, pos: { x, y }, pressed };
}

const KEY_NAMES: Record<string, [mac: string, other: string]> = {
  mod: ['⌘', 'Ctrl'], cmd: ['⌘', 'Ctrl'], meta: ['⌘', 'Win'], ctrl: ['⌃', 'Ctrl'], control: ['⌃', 'Ctrl'],
  shift: ['⇧', 'Shift'], alt: ['⌥', 'Alt'], option: ['⌥', 'Alt'], enter: ['↵', 'Enter'], return: ['↵', 'Enter'],
  escape: ['Esc', 'Esc'], esc: ['Esc', 'Esc'], tab: ['⇥', 'Tab'], backspace: ['⌫', 'Backspace'], space: ['Space', 'Space'],
  arrowup: ['↑', '↑'], arrowdown: ['↓', '↓'], arrowleft: ['←', '←'], arrowright: ['→', '→'],
};

/** "Mod+Enter" → "⌘↵" on a Mac, "Ctrl+Enter" elsewhere. */
export function formatKeys(keys: string, mac: boolean): string {
  const parts = keys.split('+').map((k) => k.trim()).filter(Boolean).map((k) => {
    const named = KEY_NAMES[k.toLowerCase()];
    if (named) return mac ? named[0] : named[1];
    return k.length === 1 ? k.toUpperCase() : k;
  });
  return parts.join(mac ? '' : '+');
}

/** What the overlay should show now. Pure; reads the page only through `look`. */
export function view(s: PlayerState, tr: NormalisedTrace, look: LookFn, cfg: Config): View {
  const count = tr.steps.length;
  const hidden: View = { phase: s.phase, cursor: { x: 0, y: 0, pressed: false, visible: false }, ring: null, caption: null, chip: null, index: s.i, count };
  if (s.phase === 'idle' || !s.pos) return hidden;
  const t = s.clock.elapsed;
  const step = tr.steps[s.i];

  let caption: View['caption'] = null;
  if (s.phase === 'waiting') caption = { text: `Looking for “${labelOf(step.target)}”…`, key: -2 - s.i };
  else if (s.phase === 'paused' && s.why === 'takeover' && cfg.resumeHint) caption = { text: 'Your turn. Press play to resume the guide.', key: -1 };
  else {
    for (let j = s.i; j >= 0 && j >= s.i - 8; j -= 1) {
      const st = tr.steps[j];
      if (st.say && st.capFrom <= t && t < st.capTo) { caption = { text: st.say, key: j }; break; }
    }
  }

  let ring: View['ring'] = null;
  if (step.highlight && step.moves && s.gaveUp !== s.i) {
    const t0 = s.leg.i === s.i ? Math.max(step.travelStart, s.leg.t0) : step.travelStart;
    const l = look(s.i);
    if (l && l.w > 0 && l.h > 0 && t >= t0 + 0.6 * (step.at - t0) && t < step.end + 250) ring = { x: l.x, y: l.y, w: l.w, h: l.h };
  }

  let chip: string | null = null;
  if (t >= step.at && t <= step.end) {
    if (step.type === 'type' && step.text) {
      const span = step.end - step.at;
      const shown = span > 0 ? Math.min(step.text.length, Math.ceil(((t - step.at) / span) * step.text.length)) : step.text.length;
      chip = step.mask ? '•'.repeat(shown) : step.text.slice(0, shown);
      if (!chip) chip = null;
    } else if (step.type === 'key' && step.keys) chip = formatKeys(step.keys, cfg.mac);
  }

  return {
    phase: s.phase,
    cursor: { x: s.pos.x, y: s.pos.y, pressed: s.pressed, visible: true },
    ring,
    caption,
    chip,
    index: s.i,
    count,
  };
}
