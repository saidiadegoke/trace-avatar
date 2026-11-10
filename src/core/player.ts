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
import { hasSample, labelOf, lastAtOrBefore, pageMatches, stepAt } from './format';
import type { NStep, NormalisedTrace, Point } from './format';
import { curvePoint, samplePath } from './motion';

export type Phase = 'idle' | 'playing' | 'paused' | 'waiting' | 'ended';
/** 'handoff': perform mode reached a step it can't or may not do; the viewer does it, then carries on (Enter, Tab, a file, Done). */
export type PauseReason = 'user' | 'takeover' | 'pause-step' | 'handoff';
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
  /**
   * Perform mode: the guide acts on the page (`act` effects), hands masked fields to the viewer,
   * resumes a takeover from the next checkpoint, and never goes back (restart only).
   */
  perform?: boolean;
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
  | { readonly phase: 'waiting'; readonly since: number; readonly for: 'target' | 'wait-step' | 'page' | 'until' }
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
  /** Perform mode: step i turned out to be the viewer's (a file that couldn't be attached): their turn, there. */
  | { kind: 'handoff'; i: number }
  /** Go to step i with it still to play (resume after a page load). From idle, lands paused there. */
  | { kind: 'jump'; i: number }
  /**
   * `at`: the page the viewer is on (location.pathname); left out, every page matches.
   * `met`: whether step i's `until` holds now; left out, it always does.
   * `handoff`: perform mode, whether step i is the viewer's to do; left out, a masked type step and an upload
   * without a sample file are.
   */
  | { kind: 'frame'; now: number; look: LookFn; vp: Viewport; at?: string; met?: (i: number) => boolean; handoff?: (i: number) => boolean };

export type Effect =
  | { fx: 'step'; i: number; by: ResolvedBy | null }
  | { fx: 'ripple'; x: number; y: number }
  | { fx: 'reveal'; i: number }
  | { fx: 'scroll'; i: number }
  | { fx: 'stalled'; i: number; reason: 'not-found' | 'wait-timeout' | 'until-timeout' }
  /** Perform mode: do step i's action on the page, at (x, y) when the step aims at a point. */
  | { fx: 'act'; i: number; x?: number; y?: number }
  /** Perform mode: step i is the viewer's to do (a masked field, a file to choose, a frame). */
  | { fx: 'handoff'; i: number }
  /** Step i happens on another page: the shell tells the host, and navigates when it may. */
  | { fx: 'page'; i: number; want: string }
  | { fx: 'end' };

/** Perform mode handed a step to the viewer: what to do, where. */
export interface Turn { i: number; type: NStep['type']; label: string }

export interface View {
  phase: Phase;
  /** The viewer's turn (perform mode), shown as a card with a Done button. */
  turn?: Turn | null;
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
    case 'play': {
      if (s.phase === 'idle' || s.phase === 'ended') return [{ ...initial(s.clock.rate), phase: 'playing' }, NONE];
      if (s.phase !== 'paused') return [s, NONE];
      const going: PlayerState = { ...common(s), clock: C.stop(s.clock), leg: { i: s.i, from: s.pos, t0: s.clock.elapsed }, phase: 'playing' };
      // The viewer typed the masked field: carry on from the next step.
      if (s.why === 'handoff') {
        if (s.i + 1 < tr.steps.length) return [catchUp(going, s.i + 1, tr), NONE];
        return [{ ...going, clock: C.seek(going.clock, tr.duration), phase: 'ended' }, [{ fx: 'end' }]];
      }
      // After a takeover in perform mode, the page may have changed under the guide: resume from
      // the next checkpoint, if one lies ahead.
      if (s.why === 'takeover' && cfg.perform) {
        const k = nextCheckpoint(tr, s.i, s.fired);
        if (k > s.i) return [catchUp(going, k, tr), NONE];
      }
      return [going, NONE];
    }
    case 'pause':
      return s.phase === 'playing' || s.phase === 'waiting' ? [paused(common(s), 'user'), NONE] : [s, NONE];
    case 'toggle':
      return update(s, { kind: s.phase === 'playing' || s.phase === 'waiting' ? 'pause' : 'play' }, tr, cfg);
    case 'handoff': {
      if (s.phase !== 'playing' && s.phase !== 'waiting') return [s, NONE];
      if (m.i < 0 || m.i >= tr.steps.length || m.i > s.fired) return [s, NONE];
      const at: Common = { ...common(s), i: m.i, clock: C.seek(s.clock, tr.at[m.i]), leg: { i: m.i, from: s.pos, t0: tr.at[m.i] } };
      return [paused(at, 'handoff'), [{ fx: 'handoff', i: m.i }]];
    }
    case 'takeover':
      return s.phase === 'playing' || s.phase === 'waiting' ? [paused(common(s), 'takeover'), NONE] : [s, NONE];
    case 'stop':
      return [initial(s.clock.rate), NONE];
    case 'rate':
      return [{ ...s, clock: C.setRate(s.clock, m.r) }, NONE];
    case 'seek':
      // Perform mode can't undo what it did: only forward, or a restart from 0.
      if (cfg.perform && m.t > 0 && m.t < s.clock.elapsed) return [s, NONE];
      return [seekTo(s, m.t, tr), NONE];
    case 'jump': {
      const j = Math.min(Math.max(Math.floor(m.i), 0), tr.steps.length - 1);
      return [catchUp(s.phase === 'idle' || s.phase === 'ended' ? { ...common(s), phase: 'paused', why: 'user' } : s, j, tr), NONE];
    }
    case 'next': {
      const t = s.clock.elapsed;
      const n = tr.steps.length;
      const target = t < tr.end[s.i] - 1 ? tr.end[s.i] : s.i + 1 < n ? tr.end[s.i + 1] : tr.duration;
      return [seekTo(s, target, tr), NONE];
    }
    case 'prev': {
      if (cfg.perform) return [s, NONE];
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

/**
 * The recorded pixel point is the last resort. For a target that also has a selector, a role or
 * text, a pixel-only look counts as "not here yet" (the step waits, "Looking for…") until looking
 * has given up on that step; then the point stands in. A target with only `xy` uses it at once.
 */
export function gate(look: LookFn, tr: NormalisedTrace, gaveUp: number, at?: string): LookFn {
  return (i) => {
    // An element on another page is not this step's element, whatever it looks like.
    if (!onPage(tr.steps[i], at)) return null;
    const l = look(i);
    if (!l || l.by !== 'xy' || i === gaveUp) return l;
    const t = tr.steps[i]?.target;
    return t && (t.sel || t.role || t.text) ? null : l;
  };
}

/** Whether the viewer is on step st's page (always, when the step names none or the page is unknown). */
export function onPage(st: NStep | undefined, at: string | undefined): boolean {
  return !st?.page || at === undefined || pageMatches(st.page, at);
}

/**
 * When the viewer has gone on ahead of the guide (clicked through before it got there), the first
 * step after i on their page, so the guide catches up; else -1. "Ahead" means they have left the
 * page the guide is on (step i-1's) for a later step's page. Still being on that page just means
 * they haven't moved yet. A guide never skips its own start.
 */
export function aheadOn(tr: NormalisedTrace, i: number, at: string | undefined): number {
  if (at === undefined || i === 0) return -1;
  const here = tr.steps[i - 1].page;
  if (!here || pageMatches(here, at)) return -1;
  for (let j = i + 1; j < tr.steps.length; j += 1) {
    const p = tr.steps[j].page;
    if (p && pageMatches(p, at)) return j;
  }
  return -1;
}

/** The first checkpoint step at or after i that hasn't happened yet, or -1. */
export function nextCheckpoint(tr: NormalisedTrace, i: number, fired: number): number {
  for (let k = Math.max(i, fired + 1); k < tr.steps.length; k += 1) if (tr.steps[k].checkpoint) return k;
  return -1;
}

/** Jump to the start of step j with j still to play (a plain seek to a step's start can count it done). */
function catchUp(s: PlayerState, j: number, tr: NormalisedTrace): PlayerState {
  const n = seekTo(s, tr.travelStart[j], tr);
  if (n.phase === 'idle') return n;
  return { ...n, i: j, fired: Math.min(n.fired, j - 1), revealed: j - 1, leg: { i: j, from: n.pos, t0: tr.travelStart[j] } };
}

function frame(s: PlayerState, m: Extract<Msg, { kind: 'frame' }>, tr: NormalisedTrace, cfg: Config): [PlayerState, Effect[]] {
  if (s.phase === 'idle') return [s, NONE];
  const fx: Effect[] = [];
  const at = (st: PlayerState) => ({ ...m, look: gate(m.look, tr, st.gaveUp, m.at) });
  let next: PlayerState = s;
  if (s.phase === 'playing') next = advance(s, at(s), tr, cfg, fx);
  else if (s.phase === 'waiting') next = waitFrame(s, at(s), tr, fx);
  return [withPose(next, at(next), tr, cfg), fx];
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

    // The next step is on another page: say so at once (not when its travel would start), don't
    // search, and wait for the viewer (or the host) to get there.
    if (fired < i && !onPage(st, m.at)) {
      const j = aheadOn(tr, i, m.at);
      if (j >= 0) return catchUp({ ...build(), phase: 'playing' }, j, tr);
      t = Math.min(Math.max(prevT, t), st.travelStart);
      fx.push({ fx: 'page', i, want: st.page! });
      return { ...build(), phase: 'waiting', since: m.now, for: 'page' };
    }

    if (t < st.travelStart) break;

    // A `wait … until` holds until its condition is met (the shell checks it a few times a second).
    if (st.until && gaveUp !== i && fired < i && !(m.met ? m.met(i) : true)) {
      t = Math.max(prevT, st.travelStart);
      return { ...build(), phase: 'waiting', since: m.now, for: 'until' };
    }

    // Entering this step: its element must be there before the cursor sets off.
    if (st.target && !st.until && gaveUp !== i && fired < i) {
      const l = m.look(i);
      if (!l) {
        t = Math.max(prevT, st.travelStart);
        return { ...build(), phase: 'waiting', since: m.now, for: st.type === 'wait' ? 'wait-step' : 'target' };
      }
      if (st.moves && revealed < i && !l.inView) { fx.push({ fx: 'reveal', i }); revealed = i; }
    }

    if (fired < i && t >= st.at) {
      fired = i;
      const l = st.target ? m.look(i) : null;
      fx.push({ fx: 'step', i, by: l ? l.by : null });
      const p = l ? pointOf(l, st) : null;
      if ((st.type === 'click' || st.type === 'dblclick') && p) fx.push({ fx: 'ripple', x: p.x, y: p.y });
      if (st.type === 'scroll') fx.push({ fx: 'scroll', i });
      if (cfg.perform && ACTS.has(st.type)) {
        // What the guide can't or may not do (a masked field, a file to choose): the viewer does it.
        if (m.handoff ? m.handoff(i) : defaultHandoff(st)) {
          fx.push({ fx: 'handoff', i });
          t = st.at;
          return paused(build(), 'handoff');
        }
        fx.push(p ? { fx: 'act', i, x: p.x, y: p.y } : { fx: 'act', i });
      }
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
        if (cfg.loop && !cfg.perform) return { ...initial(c.rate), phase: 'playing', clock: { elapsed: 0, rate: c.rate, last: m.now } };
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
  // A page wait has no timeout: the viewer may take a while to get there.
  if (s.for === 'page') {
    if (onPage(st, m.at)) return { ...common(s), clock, leg: { i: s.i, from: s.pos, t0: clock.elapsed }, phase: 'playing' };
    const j = aheadOn(tr, s.i, m.at);
    return j >= 0 ? catchUp({ ...s, clock }, j, tr) : { ...s, clock };
  }
  const here = s.for === 'until' ? (m.met ? m.met(s.i) : true) : !!m.look(s.i);
  if (here) return { ...common(s), clock, leg: { i: s.i, from: s.pos, t0: clock.elapsed }, phase: 'playing' };
  if (m.now - s.since >= st.timeout) {
    fx.push({ fx: 'stalled', i: s.i, reason: s.for === 'until' ? 'until-timeout' : st.type === 'wait' ? 'wait-timeout' : 'not-found' });
    // Carry on without the element: the step keeps its time and caption, the cursor stays put.
    return { ...common(s), clock, gaveUp: s.i, leg: { i: s.i, from: s.pos, t0: clock.elapsed }, phase: 'playing' };
  }
  return { ...s, clock };
}

/** Steps perform mode acts out (scroll has its own effect in both modes). */
const ACTS: ReadonlySet<string> = new Set(['click', 'dblclick', 'type', 'upload', 'key', 'hover']);

/** Without the shell's say: a trace never knows a masked field's text, nor a file it doesn't carry. */
const defaultHandoff = (st: NStep): boolean => (st.type === 'type' && st.mask) || (st.type === 'upload' && !(st.files ?? []).some(hasSample));

/** What the viewer is asked to do at a hand-off. The shell may say it more exactly (it knows the field). */
export function turnCaption(type: NStep['type'], label: string): string {
  if (type === 'upload') return `Your turn: choose a file for “${label}”.`;
  if (type === 'type') return `Your turn: type in “${label}”, then press Enter.`;
  return `Your turn: do “${label}”, then press Done.`;
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
    if (!st.moves) return null;
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
export function view(s: PlayerState, tr: NormalisedTrace, rawLook: LookFn, cfg: Config, at?: string): View {
  const look = gate(rawLook, tr, s.gaveUp, at);
  const count = tr.steps.length;
  const hidden: View = { phase: s.phase, turn: null, cursor: { x: 0, y: 0, pressed: false, visible: false }, ring: null, caption: null, chip: null, index: s.i, count };
  // On the wrong page the caption says where to go, even before the cursor has appeared.
  if (s.phase === 'waiting' && s.for === 'page') {
    const want = tr.steps[s.i].page!.replace(/\/\*(?=\/|$)/g, '/…');
    return { ...hidden, cursor: { ...hidden.cursor, x: s.pos?.x ?? 0, y: s.pos?.y ?? 0, visible: !!s.pos }, caption: { text: `Open ${want} to continue`, key: -1000 - s.i } };
  }
  if (s.phase === 'idle' || !s.pos) return hidden;
  const t = s.clock.elapsed;
  const step = tr.steps[s.i];

  let caption: View['caption'] = null;
  if (s.phase === 'waiting' && s.for === 'until') {
    const u = step.until!;
    caption = { text: step.say ?? (u.gone ? `Waiting for “${labelOf(step.target)}” to go away…` : `Waiting for “${u.text}”…`), key: -3 - s.i };
  } else if (s.phase === 'waiting') caption = { text: `Looking for “${labelOf(step.target)}”…`, key: -2 - s.i };
  else if (s.phase === 'paused' && s.why === 'handoff') caption = { text: turnCaption(step.type, labelOf(step.target)), key: -4 - s.i };
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
    turn: s.phase === 'paused' && s.why === 'handoff' ? { i: s.i, type: step.type, label: labelOf(step.target) } : null,
    cursor: { x: s.pos.x, y: s.pos.y, pressed: s.pressed, visible: true },
    ring,
    caption,
    chip,
    index: s.i,
    count,
  };
}
