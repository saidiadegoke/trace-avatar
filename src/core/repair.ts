/**
 * Repairing a step whose element can't be found: score the page's candidates against what the step was
 * looking for, and ask an AI only when the scores don't settle it. PURE.
 *
 * The new target itself is never invented here: the chosen element is re-recorded on the page
 * (buildTarget), as if a person had just clicked it.
 */

import type { Target, Trace } from './format';
import type { Ai, Suggestion } from './assist';

/** Something on the page a step could act on. `key` (an id or test id) is used for scoring, never sent. */
export interface Candidate {
  id: number;
  role: string | null;
  name: string;
  text?: string;
  /** The closest heading or labelled region. */
  near?: string;
  key?: string;
}

export interface Scored { id: number; score: number }

/** A clear winner needs no AI: at least this score, and this far ahead of the next. */
export const CLEAR = { min: 0.8, margin: 0.2 } as const;

const words = (s: string | undefined): string[] => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** How alike two labels are, 0..1: shared words, one inside the other, or spelling. */
export function similarity(a: string | undefined, b: string | undefined): number {
  const A = words(a);
  const B = words(b);
  if (!A.length || !B.length) return 0;
  const sa = A.join(' ');
  const sb = B.join(' ');
  if (sa === sb) return 1;
  const setB = new Set(B);
  const both = new Set(A.filter((w) => setB.has(w))).size;
  const union = new Set([...A, ...B]).size;
  const inside = both / Math.min(new Set(A).size, setB.size);
  return Math.max(both / union, 0.9 * inside, 1 - lev(sa, sb) / Math.max(sa.length, sb.length));
}

/** The id or test id an old selector named ("#save", "[data-testid=\"save\"]"). */
const keysOf = (sel: string | undefined): string[] => {
  if (!sel) return [];
  const out: string[] = [];
  for (const m of sel.matchAll(/#([\w-]+)|\[data-(?:testid|test|cy|test-id)=["']?([^"'\]]+)/g)) out.push(m[1] ?? m[2]);
  return out;
};

/** Every candidate scored against what the step was looking for (best first). */
export function scoreCandidates(target: Target | undefined, candidates: readonly Candidate[], say?: string): Scored[] {
  const t = target ?? {};
  const keys = keysOf(t.sel);
  const scored = candidates.map((c) => {
    const label = Math.max(similarity(t.name, c.name), similarity(t.text, c.text ?? c.name), similarity(t.name, c.text), similarity(t.text, c.name));
    const fromSay = say ? 0.6 * Math.max(similarity(say, c.name), similarity(say, c.text)) : 0;
    let s = 0.85 * Math.max(label, fromSay);
    if (t.role && c.role) s += t.role === c.role ? 0.15 : -0.1;
    if (c.key && keys.includes(c.key)) s += 0.3;
    return { id: c.id, score: Math.round(Math.max(0, Math.min(1, s)) * 1000) / 1000 };
  });
  return scored.sort((a, b) => b.score - a.score || a.id - b.id);
}

/** The winner when the scores settle it, else null. */
export function clearWinner(scored: readonly Scored[]): Scored | null {
  const [a, b] = scored;
  return a && a.score >= CLEAR.min && a.score - (b?.score ?? 0) >= CLEAR.margin ? a : null;
}

const label = (t: Pick<Target, 'role' | 'name' | 'text' | 'sel'> | Candidate | undefined): string => {
  if (!t) return 'nothing';
  const name = t.name || t.text;
  return t.role && name ? `${t.role} “${name}”` : name ? `“${name}”` : ('sel' in t && t.sel) || 'an element';
};
export { label as targetLabel };

/** Typed values in the trace (what was typed is never sent, even when the page shows it back). */
const typedOf = (trace: Trace): string[] => trace.steps.filter((s) => s.type === 'type' && typeof s.text === 'string' && s.text.trim().length >= 3).map((s) => s.text!.trim().toLowerCase());

const describe = (trace: Trace, i: number) => {
  const s = trace.steps[i];
  if (!s) return null;
  const t = s.target;
  return { n: i + 1, type: s.type, ...(s.say ? { say: s.say } : {}), ...(t && (t.role || t.name || t.text) ? { was: { ...(t.role ? { role: t.role } : {}), ...(t.name ? { name: t.name } : {}), ...(t.text ? { text: t.text } : {}) } } : {}) };
};

export const REPAIR_SCHEMA = { type: 'object', properties: { id: { type: ['integer', 'null'] }, why: { type: 'string' } }, required: ['id'] };
const REPAIR_INSTRUCTIONS = 'A step of a screen guide can no longer find its element: the app changed. From the elements on the page now, pick the one the step means (the same action, perhaps renamed or moved), using the step, its caption and the steps around it. If none of them is right, answer id null. Never guess wildly. Answer with JSON: { "id": <candidate id or null>, "why": "<one short sentence>" }.';

/**
 * What an AI is asked: the step, the steps around it, and the best `max` candidates (no keys, nothing typed:
 * a candidate whose name or text holds a typed value is left out).
 */
export function repairPayload(trace: Trace, index: number, candidates: readonly Candidate[], o: { max?: number } = {}): { input: unknown; schema: Record<string, unknown>; instructions: string; sent: number[] } {
  const typed = typedOf(trace);
  const clean = candidates.filter((c) => !typed.some((v) => `${c.name} ${c.text ?? ''} ${c.near ?? ''}`.toLowerCase().includes(v)));
  const step = trace.steps[index];
  const order = scoreCandidates(step?.target, clean, step?.say).slice(0, o.max ?? 30).map((s) => s.id);
  const byId = new Map(clean.map((c) => [c.id, c]));
  const list = order.map((id) => { const c = byId.get(id)!; return { id, role: c.role, name: c.name.slice(0, 80), ...(c.text && c.text !== c.name ? { text: c.text.slice(0, 80) } : {}), ...(c.near ? { near: c.near.slice(0, 60) } : {}) }; });
  return {
    input: {
      title: trace.meta?.title ?? null,
      step: describe(trace, index),
      before: [describe(trace, index - 2), describe(trace, index - 1)].filter(Boolean),
      after: [describe(trace, index + 1)].filter(Boolean),
      candidates: list,
    },
    schema: REPAIR_SCHEMA,
    instructions: REPAIR_INSTRUCTIONS,
    sent: order,
  };
}

/** The AI's pick, if it is one of the candidates it was sent. */
export function toRepairChoice(answer: unknown, sent: readonly number[]): { id: number | null; why?: string } {
  const a = (answer ?? {}) as { id?: unknown; why?: unknown };
  const why = typeof a.why === 'string' ? a.why.replace(/\s+/g, ' ').trim().slice(0, 140) : undefined;
  const id = typeof a.id === 'number' && sent.includes(a.id) ? a.id : null;
  return { id, ...(why ? { why } : {}) };
}

export interface RepairChoice {
  /** The chosen candidate, or null (a person picks from `top`). */
  id: number | null;
  /** 'score': code settled it (no AI call); 'ai': the AI chose; 'none': unsure and no AI. */
  by: 'score' | 'ai' | 'none';
  score?: number;
  why?: string;
  /** The three best by score. */
  top: Scored[];
}

/**
 * Which candidate a stalled step means: code scores them first, and an AI is asked only when no candidate
 * is a clear winner. `image` (a screenshot of the page) is sent only when given.
 */
export async function chooseRepair(trace: Trace, index: number, candidates: readonly Candidate[], o: { ai?: Ai; image?: { png: Uint8Array; label: string } } = {}): Promise<RepairChoice> {
  const step = trace.steps[index];
  const scored = scoreCandidates(step?.target, candidates, step?.say);
  const top = scored.slice(0, 3);
  const win = clearWinner(scored);
  if (win) return { id: win.id, by: 'score', score: win.score, top };
  if (!o.ai) return { id: null, by: 'none', top };
  const p = repairPayload(trace, index, candidates);
  if (!p.sent.length) return { id: null, by: 'none', top };
  const c = toRepairChoice(await o.ai('repair', p.input, p.schema, { instructions: p.instructions, ...(o.image ? { images: [o.image] } : {}) }), p.sent);
  return { id: c.id, by: c.id === null ? 'none' : 'ai', ...(c.id !== null ? { score: scored.find((x) => x.id === c.id)?.score ?? 0 } : {}), ...(c.why ? { why: c.why } : {}), top };
}

/** A repair as a suggestion that apply() takes: the step's new target. */
export function repairSuggestion(trace: Trace, index: number, target: Target, o: { why?: string; verified?: boolean } = {}): Suggestion {
  return {
    task: 'repair', kind: 'target', index, value: label(target), before: label(trace.steps[index]?.target), target,
    ...(o.why ? { why: o.why } : {}), ...(o.verified !== undefined ? { verified: o.verified } : {}),
  };
}

