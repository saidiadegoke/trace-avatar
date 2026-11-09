/**
 * AI assist, the pure part: what is sent for a task, and turning a model's answer into checked
 * suggestions a person accepts one by one. No model code here, nothing sent from here. PURE.
 *
 * Never in a payload: typed text (unless `sendTyped`, and never a masked field's), selectors, coordinates.
 */

import { validate } from './format';
import type { Step, Target, Trace } from './format';

export type AssistTask = 'captions' | 'waits' | 'title' | 'describe' | 'qa' | 'repair';

/** A provider: one call per task, returning JSON for the schema. Any model, any transport. */
export type Ai = (
  task: AssistTask,
  input: unknown,
  schema: Record<string, unknown>,
  o: { instructions: string; images?: Array<{ png: Uint8Array; label: string }> },
) => Promise<unknown>;

/** Texts that appeared on the page after a step (from the recorder), for the waits task. */
export interface Hint { after: number; texts: string[] }

export interface AssistOptions {
  /** For waits: what the recorder saw appear after each step (step indexes from 0). */
  hints?: readonly Hint[];
  /** Send what was typed into unmasked fields (never masked ones). Default false. */
  sendTyped?: boolean;
  /** Captions' tone. Default 'friendly'. */
  tone?: 'friendly' | 'terse' | 'formal';
}

export interface Suggestion {
  task: 'captions' | 'waits' | 'title' | 'repair';
  /** captions: the step's caption; waits: a new wait step after `index`; title: meta.title; repair: a new target. */
  kind: 'say' | 'wait' | 'title' | 'target';
  /** Step index (from 0): the step captioned, or the step the wait goes after. -1 for the title. */
  index: number;
  value: string;
  before?: string;
  why?: string;
  /** repair: the step's new target (re-recorded from the element on the page). */
  target?: Target;
  /** repair: the guide played past this step with the new target. */
  verified?: boolean;
}

export interface Dropped { why: string; item: unknown }

export const CAPS = { say: 140, title: 80, waitText: 60, alt: 250, chapter: 50 } as const;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** What a step is, in words a model can use, without anything typed or any selector. */
function describeStep(s: Step, i: number, page: string | undefined, o: AssistOptions) {
  const t = s.target;
  const what = t ? [t.role, t.name ? `“${t.name}”` : t.text ? `“${t.text.slice(0, 60)}”` : ''].filter(Boolean).join(' ') || 'an element' : undefined;
  return {
    n: i + 1,
    type: s.type,
    ...(what ? { on: what } : {}),
    ...(page ? { page } : {}),
    ...(s.say ? { say: s.say } : {}),
    ...(s.type === 'type' && o.sendTyped && !s.mask && s.text ? { typed: s.text.slice(0, 80) } : {}),
    ...(s.type === 'type' && s.mask ? { masked: true } : {}),
    ...(s.type === 'key' && s.keys ? { keys: s.keys } : {}),
    ...(s.type === 'wait' && s.until ? { until: s.until.text !== undefined ? { text: s.until.text } : { gone: true } } : {}),
    ...(s.t !== undefined ? { at: Math.round(s.t / 100) / 10 } : {}),
  };
}

const stepsOf = (trace: Trace, o: AssistOptions) => {
  let page: string | undefined;
  return trace.steps.map((s, i) => { if (s.page) page = s.page; return describeStep(s, i, page, o); });
};

const SCHEMAS: Record<Exclude<AssistTask, 'qa' | 'repair'>, Record<string, unknown>> = {
  captions: { type: 'object', required: ['steps'], properties: { steps: { type: 'array', items: { type: 'object', required: ['n', 'say'], properties: { n: { type: 'integer' }, say: { type: 'string', maxLength: CAPS.say } } } } } },
  waits: { type: 'object', required: ['waits'], properties: { waits: { type: 'array', items: { type: 'object', required: ['after', 'text'], properties: { after: { type: 'integer' }, text: { type: 'string' }, why: { type: 'string' } } } } } },
  title: { type: 'object', required: ['title'], properties: { title: { type: 'string', maxLength: CAPS.title } } },
  describe: { type: 'object', required: ['alt', 'chapters'], properties: { alt: { type: 'string', maxLength: CAPS.alt }, chapters: { type: 'array', items: { type: 'object', required: ['n', 'name'], properties: { n: { type: 'integer' }, name: { type: 'string', maxLength: CAPS.chapter } } } } } },
};

const TONES = {
  friendly: 'warm and plain, like a helpful colleague',
  terse: 'short and direct, a few words each',
  formal: 'clear and formal, for documentation',
};

/** Exactly what a task sends: the input, the schema of the answer, and the instructions. */
export function payload(task: Exclude<AssistTask, 'qa' | 'repair'>, trace: Trace, o: AssistOptions = {}): { input: unknown; schema: Record<string, unknown>; instructions: string } {
  const steps = stepsOf(trace, o);
  const title = trace.meta?.title;
  const schema = SCHEMAS[task];
  if (task === 'captions') {
    return {
      input: { title, steps },
      schema,
      instructions: `You write the captions of an on-screen guide: an avatar moves a cursor through a web app and each step shows a caption while it happens. Write one caption per step, ${TONES[o.tone ?? 'friendly']}, at most ${CAPS.say} characters, saying what the step does and why it matters to the viewer, in the second person ("Click Save to keep your invoice"). Keep a step's existing caption if it is already good. Never invent values the viewer types. Reply with JSON only: {"steps":[{"n":1,"say":"…"}]}.`,
    };
  }
  if (task === 'waits') {
    const hints = (o.hints ?? []).filter((h) => h.texts.length).map((h) => ({ after: h.after + 1, appeared: h.texts.slice(0, 5).map((t) => oneLine(t).slice(0, CAPS.waitText)) }));
    return {
      input: { steps, appeared: hints },
      schema,
      instructions: 'An on-screen guide replays steps in a web app. Some actions take time (saving, loading, sending), and the next step must wait for the app. You get the steps and, after some steps, the texts that appeared on the page within 3 seconds. Suggest a wait after a step only where the app is slow and a text that appeared shows it is done (e.g. "Saved", "Sent to Ada"), using that exact text or a short part of it. Do not suggest waits after typing or where nothing appeared. Reply with JSON only: {"waits":[{"after":2,"text":"Saved","why":"…"}]}.',
    };
  }
  if (task === 'title') {
    return {
      input: { title, steps },
      schema,
      instructions: `Name this on-screen guide: a short task title a viewer would search for, at most ${CAPS.title} characters, starting with a verb ("Send an invoice"). Reply with JSON only: {"title":"…"}.`,
    };
  }
  return {
    input: { title, steps },
    schema,
    instructions: `Describe this guide for a GIF or video: "alt" is alt text (at most ${CAPS.alt} characters) saying what the animation shows; "chapters" names the main parts, each starting at a step number, at most ${CAPS.chapter} characters each, 2–8 of them. Reply with JSON only: {"alt":"…","chapters":[{"n":1,"name":"…"}]}.`,
  };
}

const arr = (v: unknown, key: string): unknown[] | null => {
  const x = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;
  return Array.isArray(x) ? x : null;
};

/** A trace with these suggestions in it (indexes refer to the trace as given). Doesn't check. */
export function applyRaw(trace: Trace, accepted: readonly Suggestion[]): Trace {
  const out: Trace = JSON.parse(JSON.stringify(trace));
  for (const s of accepted) {
    if (s.kind === 'say' && out.steps[s.index]) out.steps[s.index].say = s.value;
    if (s.kind === 'title') out.meta = { ...(out.meta ?? {}), title: s.value };
    if (s.kind === 'target' && s.target && out.steps[s.index]) out.steps[s.index].target = s.target;
  }
  // Inserts last, from the end, so earlier indexes stay right.
  const waits = accepted.filter((s) => s.kind === 'wait').slice().sort((a, b) => b.index - a.index);
  for (const w of waits) out.steps.splice(w.index + 1, 0, { type: 'wait', until: { text: w.value }, timeout: 15_000 });
  return out;
}

/** Apply accepted suggestions. Throws when the result isn't a valid trace (it shouldn't: each was checked). */
export function apply(trace: Trace, accepted: readonly Suggestion[]): Trace {
  const out = applyRaw(trace, accepted);
  const v = validate(out);
  if (!v.ok) throw new Error(`the suggestions make an invalid trace: ${v.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return out;
}

/** A model's answer → suggestions that each pass the checks; the rest dropped, with why. */
export function toSuggestions(task: 'captions' | 'waits' | 'title', trace: Trace, answer: unknown, o: AssistOptions = {}): { suggestions: Suggestion[]; dropped: Dropped[] } {
  const suggestions: Suggestion[] = [];
  const dropped: Dropped[] = [];
  const check = (s: Suggestion, item: unknown) => {
    const v = validate(applyRaw(trace, [s]));
    if (!v.ok) dropped.push({ why: `makes the trace invalid (${v.errors[0]?.message})`, item });
    else suggestions.push(s);
  };
  const n = trace.steps.length;
  if (task === 'captions') {
    const list = arr(answer, 'steps');
    if (!list) return { suggestions, dropped: [{ why: 'the answer has no "steps" list', item: answer }] };
    const seen = new Set<number>();
    for (const item of list) {
      const r = item as { n?: unknown; say?: unknown };
      if (!Number.isInteger(r?.n) || (r.n as number) < 1 || (r.n as number) > n) { dropped.push({ why: 'no such step', item }); continue; }
      const i = (r.n as number) - 1;
      if (typeof r.say !== 'string' || !oneLine(r.say)) { dropped.push({ why: 'no caption text', item }); continue; }
      const say = oneLine(r.say);
      if (say.length > CAPS.say) { dropped.push({ why: `longer than ${CAPS.say} characters`, item }); continue; }
      if (seen.has(i)) { dropped.push({ why: 'a second caption for the same step', item }); continue; }
      seen.add(i);
      const before = trace.steps[i].say;
      if (before === say) continue;
      check({ task, kind: 'say', index: i, value: say, ...(before ? { before } : {}) }, item);
    }
  } else if (task === 'waits') {
    const list = arr(answer, 'waits');
    if (!list) return { suggestions, dropped: [{ why: 'the answer has no "waits" list', item: answer }] };
    const seen = new Set<number>();
    for (const item of list) {
      const r = item as { after?: unknown; text?: unknown; why?: unknown };
      if (!Number.isInteger(r?.after) || (r.after as number) < 1 || (r.after as number) > n) { dropped.push({ why: 'no such step', item }); continue; }
      const i = (r.after as number) - 1;
      const text = typeof r.text === 'string' ? oneLine(r.text) : '';
      if (!text || text.length > CAPS.waitText) { dropped.push({ why: 'no usable text to wait for', item }); continue; }
      // Only a text the page really showed after that step: a model can't make one up.
      const shown = (o.hints ?? []).filter((h) => h.after === i).flatMap((h) => h.texts.map(oneLine));
      if (!shown.some((t) => t.includes(text))) { dropped.push({ why: 'that text did not appear after the step', item }); continue; }
      const next = trace.steps[i + 1];
      if (next?.type === 'wait') { dropped.push({ why: 'the next step already waits', item }); continue; }
      if (seen.has(i)) { dropped.push({ why: 'a second wait after the same step', item }); continue; }
      seen.add(i);
      check({ task, kind: 'wait', index: i, value: text, ...(typeof r.why === 'string' ? { why: oneLine(r.why).slice(0, 140) } : {}) }, item);
    }
  } else {
    const t = answer && typeof answer === 'object' ? (answer as { title?: unknown }).title : undefined;
    const title = typeof t === 'string' ? oneLine(t) : '';
    if (!title) dropped.push({ why: 'no title', item: answer });
    else if (title.length > CAPS.title) dropped.push({ why: `longer than ${CAPS.title} characters`, item: answer });
    else if (title !== trace.meta?.title) check({ task, kind: 'title', index: -1, value: title, ...(trace.meta?.title ? { before: trace.meta.title } : {}) }, answer);
  }
  return { suggestions, dropped };
}

/** The describe task's answer, checked: alt text and chapter names (by step index from 0). */
export function toDescription(trace: Trace, answer: unknown): { alt: string | null; chapters: Array<{ index: number; name: string }>; dropped: Dropped[] } {
  const dropped: Dropped[] = [];
  const a = answer && typeof answer === 'object' ? (answer as { alt?: unknown }).alt : undefined;
  let alt: string | null = typeof a === 'string' ? oneLine(a) : null;
  if (!alt) { dropped.push({ why: 'no alt text', item: answer }); alt = null; } else if (alt.length > CAPS.alt) { dropped.push({ why: `alt text longer than ${CAPS.alt} characters`, item: alt }); alt = null; }
  const chapters: Array<{ index: number; name: string }> = [];
  for (const item of arr(answer, 'chapters') ?? []) {
    const r = item as { n?: unknown; name?: unknown };
    const name = typeof r?.name === 'string' ? oneLine(r.name) : '';
    if (!Number.isInteger(r?.n) || (r.n as number) < 1 || (r.n as number) > trace.steps.length || !name || name.length > CAPS.chapter) { dropped.push({ why: 'not a usable chapter', item }); continue; }
    if (chapters.some((c) => c.index === (r.n as number) - 1)) continue;
    chapters.push({ index: (r.n as number) - 1, name });
  }
  chapters.sort((x, y) => x.index - y.index);
  return { alt, chapters, dropped };
}

/** A model's reply text → JSON (tolerates ```json fences and text around one object). */
export function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* look for the object */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new Error('the model did not reply with JSON');
}
