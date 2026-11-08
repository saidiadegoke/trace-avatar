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

import type { Avatar, Meta, Step, Target, Trace } from './format';
import { simplify } from './motion';

export type DraftKind = 'click' | 'dblclick' | 'type' | 'key' | 'scroll';

export interface Draft {
  kind: DraftKind;
  /** ms since the recording started (pauses excluded). */
  t: number;
  target?: Target;
  /** Identity of the element/scroller, to tell drafts on the same thing apart. */
  key?: string;
  text?: string;
  mask?: boolean;
  keys?: string;
  to?: { x?: number; y?: number };
}

export const MERGE = { dblclickMs: 500, typeGapMs: 2000, scrollGapMs: 300 } as const;

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
      last.d = { ...last.d, text: d.text, mask: d.mask };
      last.lastT = d.t;
      continue;
    }
    // One scroll gesture becomes one step to where it ended.
    if (d.kind === 'scroll' && last && last.d.kind === 'scroll' && last.d.key === d.key && d.t - last.lastT <= MERGE.scrollGapMs) {
      last.d = { ...last.d, to: d.to };
      last.lastT = d.t;
      continue;
    }
    out.push({ d: { ...d }, lastT: d.t });
  }
  return out.map((x) => x.d);
}

function toStep(d: Draft): Step {
  const t = Math.round(d.t);
  switch (d.kind) {
    case 'click':
    case 'dblclick':
      return { type: d.kind, t, target: d.target! };
    case 'type':
      return { type: 'type', t, target: d.target!, text: d.text ?? '', ...(d.mask ? { mask: true } : {}) };
    case 'key':
      return { type: 'key', t, keys: d.keys!, ...(d.target ? { target: d.target } : {}) };
    case 'scroll':
      return { type: 'scroll', t, to: d.to ?? {}, ...(d.target ? { target: d.target } : {}) };
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
}

/** Build a trace, or null when nothing worth replaying was recorded. */
export function build(input: BuildInput): Trace | null {
  const steps = coalesce(input.drafts)
    .filter((d) => (d.kind === 'key' ? !!d.keys : d.kind === 'scroll' ? true : !!d.target))
    .map(toStep);
  if (!steps.length) return null;
  let path: number[][] | null = null;
  if (input.keepPath !== false && input.path && input.path.length >= 6) {
    const simple = simplify(input.path, 2);
    path = [];
    for (let i = 0; i < simple.length; i += 3) path.push([Math.round(simple[i]), Math.round(simple[i + 1]), Math.round(simple[i + 2])]);
  }
  return {
    version: 1,
    meta: input.meta,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    steps,
    ...(path ? { path } : {}),
  };
}
