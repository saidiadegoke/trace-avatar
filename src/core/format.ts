/**
 * The trace format (version 1): parse, upcast, normalise.
 *
 * Parse, don't validate: raw JSON goes in, a frozen `NormalisedTrace` or a list
 * of errors comes out. Nothing downstream re-checks shapes.
 *
 * PURE: no DOM, no clock, no randomness.
 */

export type StepType = 'move' | 'click' | 'dblclick' | 'type' | 'key' | 'scroll' | 'hover' | 'wait' | 'note';

export const STEP_TYPES: readonly StepType[] = ['move', 'click', 'dblclick', 'type', 'key', 'scroll', 'hover', 'wait', 'note'];

export interface Point { x: number; y: number }

/** How a step finds its element. The player tries sel → role+name → text → xy. */
export interface Target {
  sel?: string;
  role?: string;
  name?: string;
  text?: string;
  /** Where on the element, 0..1 of its box. Default: centre. */
  at?: { rx: number; ry: number };
  /** Last resort: viewport pixels at recording time, scaled by meta.viewport. */
  xy?: Point;
}

export interface Step {
  type: StepType;
  /** Milliseconds from the start at which the action happens. Omitted: right after the previous step. */
  t?: number;
  target?: Target;
  say?: string;
  highlight?: boolean;
  pause?: boolean;
  /** Travel time (ms) when `t` is omitted. */
  duration?: number;
  /** `type` */
  text?: string;
  mask?: boolean;
  /** `key`, e.g. "Mod+Enter" */
  keys?: string;
  /** `scroll` */
  to?: { x?: number; y?: number };
  by?: { x?: number; y?: number };
  /** `hover` / `note`: how long to stay (ms). */
  hold?: number;
  /** `wait` (and any target): how long to look for the element (ms). */
  timeout?: number;
  /**
   * The page this step happens on: a path, `*` matching any one segment ("/app/tasks/*").
   * Applies to the following steps too, until another step names a page. The player only looks
   * for this step's element on a matching page; elsewhere it waits for the viewer (or navigates).
   */
  page?: string;
  /** `wait`: hold until the target's text (or, without a target, the page's) contains `text`, or the target is `gone`. */
  until?: Until;
  /** Perform mode: a safe step to resume from after the viewer takes over. */
  checkpoint?: boolean;
}

/** One condition, for a start: text appears, or the target goes away. */
export type Until = { text: string; gone?: undefined } | { gone: true; text?: undefined };

export interface Avatar { name?: string; image?: string; color?: string }

export interface Meta {
  title?: string;
  recordedAt?: string;
  viewport?: { w: number; h: number };
  url?: string;
  seed?: number;
  pointer?: 'mouse' | 'touch';
  truncated?: boolean;
  /**
   * What the guide needs before it starts, as names the host defines ("signed-in", "sandbox").
   * The library doesn't interpret them; the host's `prepare` hook checks them.
   */
  requires?: string[];
}

export interface Trace {
  version: 1;
  meta?: Meta;
  avatar?: Avatar;
  steps: Step[];
  /** Optional recorded pointer path: [[t, x, y], …] or a flat [t, x, y, t, x, y, …]. */
  path?: number[][] | number[] | null;
}

/** One step after normalisation: every time filled in, every default applied. */
export interface NStep {
  readonly i: number;
  readonly type: StepType;
  readonly target: Target | null;
  /** The cursor travels to this step's target. */
  readonly moves: boolean;
  readonly travelStart: number;
  readonly at: number;
  readonly end: number;
  readonly say: string | null;
  readonly capFrom: number;
  readonly capTo: number;
  readonly highlight: boolean;
  readonly pause: boolean;
  readonly text: string | null;
  readonly mask: boolean;
  readonly keys: string | null;
  readonly to: { x?: number; y?: number } | null;
  readonly by: { x?: number; y?: number } | null;
  readonly timeout: number;
  /** The page this step happens on (inherited from earlier steps), or null for any page. */
  readonly page: string | null;
  readonly until: Until | null;
  readonly checkpoint: boolean;
}

export interface NormalisedTrace {
  readonly version: 1;
  readonly meta: Meta;
  readonly avatar: Avatar;
  readonly steps: readonly NStep[];
  /** Interval table, parallel to `steps`, for binary search. */
  readonly travelStart: Float64Array;
  readonly at: Float64Array;
  readonly end: Float64Array;
  readonly duration: number;
  /** Interleaved [t, x, y, …] in recording viewport pixels. */
  readonly path: Float32Array | null;
  readonly seed: number;
}

export interface ValidationError { path: string; message: string }
export type ParseResult = { ok: true; trace: NormalisedTrace } | { ok: false; errors: ValidationError[] };

export const LIMITS = { steps: 10_000, pathSamples: 200_000, say: 500, text: 2_000, string: 1_000, timeout: 600_000, requires: 10 } as const;

/** Timing constants (ms). */
export const TIMING = {
  travelMax: 800,
  travelDefault: 700,
  gap: 150,
  act: { move: 0, click: 250, dblclick: 450, key: 600, scroll: 700, wait: 0 } as Record<string, number>,
  typePerChar: 55,
  typeMin: 400,
  typeMax: 3000,
  hover: 800,
  noteMin: 1500,
  noteMax: 6000,
  readPerChar: 50,
  readMin: 1500,
  readMax: 7000,
  timeout: 4000,
  waitTimeout: 5000,
} as const;

/** Version upcasters: UPCASTERS[n] turns a version-n trace into version n+1. None yet. */
const UPCASTERS: Record<number, (t: any) => any> = {};
const CURRENT = 1;

const NEEDS_TARGET: ReadonlySet<StepType> = new Set(['move', 'click', 'dblclick', 'type', 'hover', 'wait']);

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function checkUrl(u: string): boolean {
  if (/^(https?:|data:image\/)/i.test(u)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(u); // relative URL, no other scheme (no javascript:)
}

/** Validate a raw trace. Returns every problem found, with a path to it. */
export function validate(raw: unknown): { ok: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => { if (errors.length < 50) errors.push({ path, message }); };
  if (!isObj(raw)) { err('', 'a trace must be an object'); return { ok: false, errors }; }
  if (raw.version !== CURRENT && !(isNum(raw.version) && UPCASTERS[raw.version])) {
    err('version', `unsupported version ${JSON.stringify(raw.version)} (this player reads version ${CURRENT})`);
    return { ok: false, errors };
  }
  const str = (v: unknown, path: string, max: number = LIMITS.string) => {
    if (v === undefined) return;
    if (typeof v !== 'string') err(path, 'must be a string');
    else if (v.length > max) err(path, `longer than ${max} characters`);
  };
  if (raw.meta !== undefined) {
    if (!isObj(raw.meta)) err('meta', 'must be an object');
    else {
      const m = raw.meta;
      str(m.title, 'meta.title'); str(m.url, 'meta.url'); str(m.recordedAt, 'meta.recordedAt');
      if (m.viewport !== undefined && !(isObj(m.viewport) && isNum(m.viewport.w) && isNum(m.viewport.h) && m.viewport.w > 0 && m.viewport.h > 0)) err('meta.viewport', 'must be { w, h } with positive numbers');
      if (m.seed !== undefined && !isNum(m.seed)) err('meta.seed', 'must be a number');
      if (m.pointer !== undefined && m.pointer !== 'mouse' && m.pointer !== 'touch') err('meta.pointer', 'must be "mouse" or "touch"');
      if (m.requires !== undefined && !(Array.isArray(m.requires) && m.requires.length <= LIMITS.requires
        && m.requires.every((r: unknown) => typeof r === 'string' && r.length > 0 && r.length <= 60))) err('meta.requires', `must be a list of at most ${LIMITS.requires} names (1–60 characters)`);
    }
  }
  if (raw.avatar !== undefined) {
    if (!isObj(raw.avatar)) err('avatar', 'must be an object');
    else {
      str(raw.avatar.name, 'avatar.name', 80); str(raw.avatar.color, 'avatar.color', 64);
      if (raw.avatar.image !== undefined) {
        if (typeof raw.avatar.image !== 'string' || !checkUrl(raw.avatar.image)) err('avatar.image', 'must be an https:, data:image/ or relative URL');
      }
    }
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) err('steps', 'must be a non-empty array');
  else if (raw.steps.length > LIMITS.steps) err('steps', `more than ${LIMITS.steps} steps`);
  else {
    raw.steps.forEach((s: unknown, i: number) => {
      const p = `steps[${i}]`;
      if (!isObj(s)) { err(p, 'must be an object'); return; }
      if (!STEP_TYPES.includes(s.type)) { err(`${p}.type`, `must be one of ${STEP_TYPES.join(', ')}`); return; }
      if (s.t !== undefined && !(isNum(s.t) && s.t >= 0)) err(`${p}.t`, 'must be a number ≥ 0');
      for (const k of ['duration', 'hold', 'timeout'] as const) if (s[k] !== undefined && !(isNum(s[k]) && s[k] >= 0)) err(`${p}.${k}`, 'must be a number ≥ 0');
      if (isNum(s.timeout) && s.timeout > LIMITS.timeout) err(`${p}.timeout`, `must be at most ${LIMITS.timeout} (10 minutes)`);
      for (const k of ['highlight', 'pause', 'mask', 'checkpoint'] as const) if (s[k] !== undefined && typeof s[k] !== 'boolean') err(`${p}.${k}`, 'must be true or false');
      if (s.until !== undefined) {
        const u = s.until;
        if (s.type !== 'wait') err(`${p}.until`, 'only a wait step has until');
        else if (!isObj(u) || (u.text === undefined) === (u.gone === undefined)) err(`${p}.until`, 'needs exactly one of text or gone');
        else if (u.text !== undefined && !(typeof u.text === 'string' && u.text.trim() && u.text.length <= LIMITS.say)) err(`${p}.until.text`, `must be text (at most ${LIMITS.say} characters)`);
        else if (u.gone !== undefined && u.gone !== true) err(`${p}.until.gone`, 'must be true');
      }
      str(s.say, `${p}.say`, LIMITS.say);
      if (s.page !== undefined && !(typeof s.page === 'string' && s.page.startsWith('/') && s.page.length <= 300)) err(`${p}.page`, 'must be a path starting with "/" (at most 300 characters)');
      if (s.target !== undefined) {
        const t = s.target;
        if (!isObj(t)) err(`${p}.target`, 'must be an object');
        else {
          str(t.sel, `${p}.target.sel`); str(t.role, `${p}.target.role`, 40); str(t.name, `${p}.target.name`); str(t.text, `${p}.target.text`);
          if (t.at !== undefined && !(isObj(t.at) && isNum(t.at.rx) && isNum(t.at.ry))) err(`${p}.target.at`, 'must be { rx, ry }');
          if (t.xy !== undefined && !(isObj(t.xy) && isNum(t.xy.x) && isNum(t.xy.y))) err(`${p}.target.xy`, 'must be { x, y }');
          if (!t.sel && !t.role && !t.text && !t.xy) err(`${p}.target`, 'needs at least one of sel, role, text or xy');
          if (t.name !== undefined && !t.role) err(`${p}.target.name`, 'is only used together with role');
        }
      } else if (NEEDS_TARGET.has(s.type) && !(s.type === 'wait' && isObj(s.until) && typeof s.until.text === 'string')) err(`${p}.target`, `a ${s.type} step needs a target`);
      if (s.type === 'type') {
        if (typeof s.text !== 'string') err(`${p}.text`, 'a type step needs text');
        else str(s.text, `${p}.text`, LIMITS.text);
      }
      if (s.type === 'key' && (typeof s.keys !== 'string' || !s.keys)) err(`${p}.keys`, 'a key step needs keys, e.g. "Mod+Enter"');
      if (s.type === 'note' && (typeof s.say !== 'string' || !s.say)) err(`${p}.say`, 'a note step needs say');
      if (s.type === 'scroll') {
        const okXY = (v: any) => isObj(v) && (v.x === undefined || isNum(v.x)) && (v.y === undefined || isNum(v.y));
        if (s.to === undefined && s.by === undefined) err(p, 'a scroll step needs to or by');
        if (s.to !== undefined && !okXY(s.to)) err(`${p}.to`, 'must be { x?, y? }');
        if (s.by !== undefined && !okXY(s.by)) err(`${p}.by`, 'must be { x?, y? }');
      }
    });
  }
  if (raw.path !== undefined && raw.path !== null) {
    const p = raw.path;
    if (!Array.isArray(p)) err('path', 'must be an array');
    else if (p.length && Array.isArray(p[0])) {
      if (p.length > LIMITS.pathSamples) err('path', `more than ${LIMITS.pathSamples} samples`);
      else if (!p.every((s: unknown) => Array.isArray(s) && s.length === 3 && s.every(isNum))) err('path', 'each sample must be [t, x, y]');
    } else {
      if (p.length % 3 !== 0) err('path', 'a flat path needs a multiple of 3 numbers');
      else if (p.length / 3 > LIMITS.pathSamples) err('path', `more than ${LIMITS.pathSamples} samples`);
      else if (!p.every(isNum)) err('path', 'must contain only numbers');
    }
  }
  return { ok: errors.length === 0, errors };
}

function upcast(raw: any): any {
  let t = raw;
  while (isNum(t.version) && t.version < CURRENT) t = UPCASTERS[t.version](t);
  return t;
}

function actTime(s: Step): number {
  switch (s.type) {
    case 'type': return clamp((s.text || '').length * TIMING.typePerChar, TIMING.typeMin, TIMING.typeMax);
    case 'hover': return s.hold ?? TIMING.hover;
    case 'note': return s.hold ?? clamp((s.say || '').length * TIMING.readPerChar, TIMING.noteMin, TIMING.noteMax);
    default: return TIMING.act[s.type] ?? 0;
  }
}

const readTime = (say: string) => clamp(say.length * TIMING.readPerChar, TIMING.readMin, TIMING.readMax);

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return o;
};

/** Parse a raw trace into the normalised, frozen form the player reads. Never mutates its input. */
export function parse(raw: unknown): ParseResult {
  const v = validate(raw);
  if (!v.ok) return { ok: false, errors: v.errors };
  const src: Trace = upcast(JSON.parse(JSON.stringify(raw)));

  // Stable sort a copy by t; steps without t keep their place after their predecessor.
  const order = src.steps.map((s, i) => ({ s, i, key: 0 }));
  let last = 0;
  for (const o of order) { if (o.s.t !== undefined) last = o.s.t; o.key = last; }
  order.sort((a, b) => a.key - b.key || a.i - b.i);

  const n = order.length;
  const travelStart = new Float64Array(n);
  const at = new Float64Array(n);
  const end = new Float64Array(n);
  const steps: NStep[] = [];
  let prevEnd = 0;
  let page: string | null = null;
  order.forEach(({ s }, i) => {
    if (s.page !== undefined) page = s.page;
    // A `wait` only watches for its element and a `note` only talks; every other step with a target travels to it.
    const moves = !!s.target && s.type !== 'wait' && s.type !== 'note';
    const travel = moves ? (s.duration ?? TIMING.travelDefault) : 0;
    const a = s.t !== undefined
      ? Math.max(s.t, prevEnd)
      : prevEnd + (i === 0 ? 0 : TIMING.gap) + travel;
    // Travel ends at the action; it starts no earlier than the previous step's end.
    const ts = moves ? Math.max(prevEnd, a - (s.t === undefined ? travel : TIMING.travelMax)) : a;
    const e = a + actTime(s);
    travelStart[i] = ts; at[i] = a; end[i] = e;
    prevEnd = e;
    steps.push({
      i,
      type: s.type,
      target: s.target ?? null,
      moves,
      travelStart: ts,
      at: a,
      end: e,
      say: s.say ?? null,
      capFrom: 0,
      capTo: 0,
      highlight: s.highlight ?? (s.type === 'click' || s.type === 'dblclick' || s.type === 'type' || s.type === 'hover'),
      pause: !!s.pause,
      text: s.type === 'type' ? (s.text ?? '') : null,
      mask: !!s.mask,
      keys: s.type === 'key' ? (s.keys ?? null) : null,
      to: s.type === 'scroll' ? (s.to ?? null) : null,
      by: s.type === 'scroll' ? (s.by ?? null) : null,
      timeout: s.timeout ?? (s.type === 'wait' ? TIMING.waitTimeout : TIMING.timeout),
      page,
      until: s.type === 'wait' && s.until ? (s.until.gone ? { gone: true } : { text: s.until.text! }) : null,
      checkpoint: !!s.checkpoint,
    });
  });

  // Caption windows: from the step's travel start for its reading time, cut by the next caption.
  let duration = prevEnd;
  const said = steps.filter((s) => s.say);
  said.forEach((s, k) => {
    const from = s.travelStart;
    let to = Math.max(s.end, from + readTime(s.say!));
    if (k + 1 < said.length) to = Math.min(to, said[k + 1].travelStart);
    (s as { capFrom: number }).capFrom = from;
    (s as { capTo: number }).capTo = to;
    duration = Math.max(duration, to);
  });

  let path: Float32Array | null = null;
  if (src.path && (src.path as unknown[]).length) {
    const flat = Array.isArray((src.path as unknown[])[0]) ? (src.path as number[][]).flat() : (src.path as number[]);
    path = new Float32Array(flat);
  }

  const trace: NormalisedTrace = {
    version: 1,
    meta: src.meta ?? {},
    avatar: src.avatar ?? {},
    steps,
    travelStart,
    at,
    end,
    duration,
    path,
    seed: src.meta?.seed ?? 1,
  };
  return { ok: true, trace: deepFreeze(trace) };
}

/** Index of the step active at time t: the first whose end is after t (last step at or after the end). */
export function stepAt(trace: NormalisedTrace, t: number): number {
  const e = trace.end;
  let lo = 0;
  let hi = e.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (e[mid] > t) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** Largest index j with arr[j] <= t, or -1. */
export function lastAtOrBefore(arr: Float64Array, t: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const segs = (path: string) => path.split(/[?#]/)[0].split('/').filter(Boolean);

/**
 * Whether a page pattern ("/app/tasks/*") matches a path ("/app/tasks/bfd02a18-…").
 * `*` matches any one segment; a trailing slash, the query and the hash don't matter.
 */
export function pageMatches(pattern: string, path: string): boolean {
  const want = segs(pattern);
  const have = segs(path);
  return want.length === have.length && want.every((w, k) => w === '*' || w === have[k] || safeDecode(w) === safeDecode(have[k]));
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** A short human label for a target, used in "Looking for …" captions. */
export function labelOf(t: Target | null): string {
  if (!t) return 'the next element';
  return t.name || t.text || t.sel || 'the next element';
}
