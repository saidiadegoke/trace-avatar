/**
 * What Do it for me may do by itself (docs: README "Security").
 *
 * By default it does everything it can: types every value it knows (passwords and amounts too) and attaches
 * every file it carries. Security limits it, guard by guard:
 *
 *   'secrets'  passwords, card numbers and codes: never typed from the trace
 *   'money'    amount and price fields: never typed from the trace
 *   'files'    uploads: no file the trace carries is attached
 *
 * A value the host passes when the guide plays (`values`) always stands in: the host chose it. Whatever the
 * guide can't or may not do is the viewer's turn (a hand-off), and the guide carries on when they're done.
 *
 * PURE.
 */

import type { FieldFacts } from './mask';
import { isMoney, isSecret } from './mask';
import { hasSample, labelOf } from './format';
import type { NStep } from './format';

export type Guard = 'secrets' | 'money' | 'files';
export const GUARDS: readonly Guard[] = ['secrets', 'money', 'files'];
/** true: every guard; a list: those; false or left out: none. */
export type Security = boolean | readonly Guard[];

export function guardsOf(s: Security | undefined): ReadonlySet<Guard> {
  if (s === true) return new Set(GUARDS);
  if (!s) return new Set();
  return new Set(s.filter((g): g is Guard => (GUARDS as readonly string[]).includes(g)));
}

/** An attribute's security: absent → undefined; "" or "true" → all; "false"/"off" → none; else a list ("secrets, money"). */
export function securityOf(attr: string | null | undefined): Security | undefined {
  if (attr === null || attr === undefined) return undefined;
  const a = attr.trim().toLowerCase();
  if (a === '' || a === 'true' || a === 'on') return true;
  if (a === 'false' || a === 'off') return false;
  return a.split(/[\s,]+/).filter((g): g is Guard => (GUARDS as readonly string[]).includes(g));
}

/** Values the host passes when a guide plays, by name or field label (any case). */
export type Values = Readonly<Record<string, string>>;

const keyOf = (k: string) => k.trim().toLowerCase();

/**
 * The value a type step takes from the host: by its `value` name, else its target's label, else the field's
 * own name, id or label (`field`, from the page).
 */
export function valueFor(values: Values | undefined, step: NStep, field?: Pick<FieldFacts, 'name' | 'id' | 'hint'> | null): string | undefined {
  if (!values || step.type !== 'type') return undefined;
  const want = [step.value, step.target?.name, step.target?.text, labelOf(step.target), field?.name, field?.id, field?.hint].filter((k): k is string => !!k).map(keyOf);
  for (const [k, v] of Object.entries(values)) if (typeof v === 'string' && want.includes(keyOf(k))) return v;
  return undefined;
}

/** What the shell knows about a step's element when it is about to act. */
export interface ElementFacts {
  field: FieldFacts | null;
  /** The element is a frame: what is inside (a payment form) can't be reached. */
  frame: boolean;
}

/** Why the viewer takes a step over. */
export type HandoffWhy = 'masked' | 'secret' | 'money' | 'file' | 'no-file' | 'frame';

/** Whether perform mode does step i itself (null), or hands it to the viewer, and why. */
export function handoffOf(step: NStep, el: ElementFacts | null, guards: ReadonlySet<Guard>, value: string | undefined): HandoffWhy | null {
  if (el?.frame && (step.type === 'click' || step.type === 'dblclick' || step.type === 'type' || step.type === 'upload')) return 'frame';
  if (step.type === 'upload') {
    if (guards.has('files')) return 'file';
    return (step.files ?? []).some(hasSample) ? null : 'no-file';
  }
  if (step.type !== 'type' || value !== undefined) return null;
  if (step.mask) return 'masked';
  if (el?.field && guards.has('secrets') && isSecret(el.field)) return 'secret';
  if (el?.field && guards.has('money') && isMoney(el.field)) return 'money';
  return null;
}
