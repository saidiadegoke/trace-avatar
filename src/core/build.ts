/**
 * Builder: recorder drafts + pointer samples → a valid trace.json.
 *
 * Raw browser events are noisy. A double-click arrives as click, click,
 * dblclick; typing arrives as one input event per key; a scroll gesture as
 * dozens of scroll events. These rules turn them into the steps a person
 * would have written.
 *
 * PURE.
 */

import type { Avatar, FileSpec, Meta, Step, Target, Trace, Until } from './format';
import { simplify } from './motion';

export type DraftKind = 'click' | 'dblclick' | 'type' | 'upload' | 'key' | 'scroll' | 'note' | 'wait';

export interface Draft {
  kind: DraftKind;
  /** ms since the recording started (pauses excluded). */
  t: number;
  target?: Target;
  /** Identity of the element/scroller, to tell drafts on the same thing apart. */
  key?: string;
  text?: string;
  mask?: boolean;
  /** `upload`: the files chosen. */
  files?: FileSpec[];
  keys?: string;
  to?: { x?: number; y?: number };
  /** The page it happened on (a pattern, ids as `*`). */
  page?: string;
  /** A caption: a note's text, or one the author added to a step while recording. */
  say?: string;
  pause?: boolean;
  /** `wait`: what to wait for. */
  until?: Until;
  /** Texts that appeared on the page just after this action (for AI wait suggestions; never saved in a trace). */
  seen?: string[];
}

export const MERGE = { dblclickMs: 500, typeGapMs: 2000, scrollGapMs: 300 } as const;

/** A pause longer than maxGapMs (a file picker, a phone call) plays back as idleMs. */
export const GAPS = { maxGapMs: 4000, idleMs: 1500 } as const;

/** 'auto': drop scrolls the player would do anyway (it scrolls each target into view). 'all': keep every one. */
export type ScrollMode = 'auto' | 'all';

/** Merge the noise. Exported for tests. Never changes its input. */
export function coalesce(drafts: readonly Draft[]): Draft[] {
  const sorted = drafts.map((d, i) => ({ d, i })).sort((a, b) => a.d.t - b.d.t || a.i - b.i).map((x) => x.d);
  const out: Array<{ d: Draft; lastT: number }> = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (d.kind === 'dblclick') {
      // The browser sends click, click, dblclick: keep only the dblclick, at the first click's time.
      let t = d.t;
      for (let k = 0; k < 2; k += 1) {
        const prev = out[out.length - 1];
        if (prev && prev.d.kind === 'click' && prev.d.key === d.key && d.t - prev.d.t <= MERGE.dblclickMs) { t = prev.d.t; out.pop(); }
      }
      out.push({ d: { ...d, t }, lastT: d.t });
      continue;
    }
    // Keystrokes into one field become one type step with the final text.
    if (d.kind === 'type' && last && last.d.kind === 'type' && last.d.key === d.key && d.t - last.lastT <= MERGE.typeGapMs) {
      last.d = { ...last.d, text: d.text, mask: d.mask, ...(d.say ? { say: d.say } : {}) };
      last.lastT = d.t;
      continue;
    }
    // One scroll gesture becomes one step to where it ended.
    if (d.kind === 'scroll' && last && last.d.kind === 'scroll' && last.d.key === d.key && d.t - last.lastT <= MERGE.scrollGapMs) {
      last.d = { ...last.d, to: d.to, ...(d.say ? { say: d.say } : {}) };
      last.lastT = d.t;
      continue;
    }
    out.push({ d: { ...d }, lastT: d.t });
  }
  return out.map((x) => x.d);
}

const TARGETED: ReadonlySet<DraftKind> = new Set(['click', 'dblclick', 'type', 'upload']);

/**
 * In 'auto' mode, a run of scrolls followed by an action on an element is dropped (the player
 * scrolls that element into view itself); any other run keeps only where each scroller ended.
 * Exported for tests. Never changes its input.
 */
export function pruneScrolls(drafts: readonly Draft[], mode: ScrollMode = 'auto'): Draft[] {
  if (mode === 'all') return drafts.slice();
  const out: Draft[] = [];
  let run: Draft[] = [];
  const flush = (nextDraft: Draft | undefined) => {
    if (!run.length) return;
    const revealed = nextDraft && (TARGETED.has(nextDraft.kind) || ((nextDraft.kind === 'key' || nextDraft.kind === 'wait') && !!nextDraft.target));
    if (!revealed) {
      const last = new Map<string, Draft>();
      for (const d of run) { const k = d.key ?? 'window'; last.delete(k); last.set(k, d); }
      out.push(...last.values());
    }
    run = [];
  };
  for (const d of drafts) {
    if (d.kind === 'scroll') { run.push(d); continue; }
    flush(d);
    out.push(d);
  }
  flush(undefined);
  return out;
}

/**
 * A time map that shortens every quiet stretch longer than maxGapMs to idleMs, keeping the
 * order of everything. Anchors are the moments that matter (step times); the pointer path in
 * between is squeezed with its stretch. Exported for tests.
 */
export function gapMap(anchors: readonly number[], maxGapMs: number = GAPS.maxGapMs, idleMs: number = GAPS.idleMs): (t: number) => number {
  if (!(maxGapMs > 0) || !Number.isFinite(maxGapMs)) return (t) => t;
  const idle = Math.min(idleMs, maxGapMs);
  const at = Array.from(new Set([0, ...anchors.filter((a) => a > 0)])).sort((a, b) => a - b);
  const to: number[] = [0];
  for (let k = 1; k < at.length; k += 1) {
    const len = at[k] - at[k - 1];
    to.push(to[k - 1] + (len > maxGapMs ? idle : len));
  }
  return (t) => {
    if (t <= 0) return t;
    let k = at.length - 1;
    while (k > 0 && at[k] > t) k -= 1;
    // Past the last anchor: never more than one idle stretch.
    if (k === at.length - 1) return to[k] + Math.min(t - at[k], idle);
    const len = at[k + 1] - at[k];
    return to[k] + (t - at[k]) * ((to[k + 1] - to[k]) / len);
  };
}

function toStep(d: Draft): Step {
  const step = stepOf(d);
  if (d.say && d.kind !== 'note') step.say = d.say;
  return step;
}

function stepOf(d: Draft): Step {
  const t = Math.round(d.t);
  switch (d.kind) {
    case 'click':
    case 'dblclick':
      return { type: d.kind, t, target: d.target! };
    case 'type':
      return { type: 'type', t, target: d.target!, text: d.text ?? '', ...(d.mask ? { mask: true } : {}) };
    case 'upload':
      return { type: 'upload', t, target: d.target!, files: d.files ?? [] };
    case 'key':
      return { type: 'key', t, keys: d.keys!, ...(d.target ? { target: d.target } : {}) };
    case 'scroll':
      return { type: 'scroll', t, to: d.to ?? {}, ...(d.target ? { target: d.target } : {}) };
    case 'note':
      return { type: 'note', t, say: d.say!, ...(d.pause ? { pause: true } : {}) };
    case 'wait':
      return { type: 'wait', t, until: d.until!, ...(d.target ? { target: d.target } : {}) };
    default: {
      const never: never = d.kind;
      return never;
    }
  }
}

export interface BuildInput {
  drafts: readonly Draft[];
  /** Interleaved [t, x, y] in viewport pixels, t in ms since start. */
  path?: ArrayLike<number> | null;
  meta: Meta;
  avatar?: Avatar;
  /** Keep the recorded pointer path (default true). */
  keepPath?: boolean;
  /** Pauses longer than this play back as GAPS.idleMs. Default GAPS.maxGapMs; 0 keeps real time. */
  maxGapMs?: number;
  /** Default 'auto'. */
  scrolls?: ScrollMode;
}

/** The drafts that become steps, one per step, in order. */
const keptOf = (input: Pick<BuildInput, 'drafts' | 'scrolls'>): Draft[] => pruneScrolls(
  coalesce(input.drafts).filter((d) => (d.kind === 'key' ? !!d.keys : d.kind === 'scroll' ? true : d.kind === 'note' ? !!d.say : d.kind === 'wait' ? !!d.until : !!d.target)),
  input.scrolls,
);

/** What appeared after each step of the built trace (step indexes as build() numbers them). */
export function hintsOf(input: Pick<BuildInput, 'drafts' | 'scrolls'>): Array<{ after: number; texts: string[] }> {
  return keptOf(input).flatMap((d, i) => (d.seen?.length ? [{ after: i, texts: d.seen.slice() }] : []));
}

/** Build a trace, or null when nothing worth replaying was recorded. */
export function build(input: BuildInput): Trace | null {
  const kept = keptOf(input);
  if (!kept.length) return null;
  const wantPath = input.keepPath !== false && !!input.path && input.path.length >= 6;
  // The path's end is an anchor only past the last step (a tail to squeeze), never between steps.
  const lastPath = wantPath ? input.path![input.path!.length - 3] : -Infinity;
  const pathEnd = lastPath > kept[kept.length - 1].t ? [lastPath] : [];
  const map = gapMap([...kept.map((d) => d.t), ...pathEnd], input.maxGapMs ?? GAPS.maxGapMs);
  // A step names its page only when it differs from the step before; later steps inherit it.
  let lastPage: string | undefined;
  const steps = kept.map((d) => {
    const step = toStep({ ...d, t: map(d.t) });
    if (d.page && d.page !== lastPage) { step.page = d.page; lastPage = d.page; }
    return step;
  });
  let path: number[][] | null = null;
  if (wantPath) {
    const simple = simplify(input.path!, 2);
    path = [];
    for (let i = 0; i < simple.length; i += 3) path.push([Math.round(map(simple[i])), Math.round(simple[i + 1]), Math.round(simple[i + 2])]);
  }
  return {
    version: 1,
    meta: input.meta,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    steps,
    ...(path ? { path } : {}),
  };
}
