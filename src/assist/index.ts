/**
 * trace-avatar/assist: AI suggestions for a guide, which a person accepts one by one.
 *
 *   import { suggest, apply, openAiCompatible } from 'trace-avatar/assist';
 *   const { suggestions } = await suggest('captions', trace, { ai });
 *   const next = apply(trace, suggestions.filter(isAccepted));
 *
 * `ai` is any function (task, input, schema, { instructions, images }) → JSON. In a page, make it call your
 * own backend: never put a model key in a page. openAiCompatible() and gateway() are ready-made ones for
 * servers and the renderer.
 */

import { parseJsonReply, payload, toDescription, toSuggestions } from '../core/assist';
import type { Ai, AssistOptions, AssistTask, Dropped, Suggestion } from '../core/assist';
import type { Trace } from '../core/format';

export { apply, applyRaw, payload as preview, parseJsonReply, toSuggestions, toDescription, CAPS } from '../core/assist';
export type { Ai, AssistOptions, AssistTask, Dropped, Hint, Suggestion } from '../core/assist';
export { scoreCandidates, clearWinner, similarity, repairPayload, toRepairChoice, targetLabel, chooseRepair, repairSuggestion, CLEAR, scoreTexts, waitPayload, toWaitChoice, chooseWait, waitSuggestion, removeStep, typedOf, guessWait, GUESS_MIN } from '../core/repair';
export type { TextCandidate, WaitChoice } from '../core/repair';
export type { Candidate, Scored, RepairChoice } from '../core/repair';

export class AssistError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** The gateway's X-AI-Request-Id (the join key to its usage record), and the models a key allows when it refused one. */
    public readonly info: { requestId?: string; allowed?: string[] } = {},
  ) { super(message); this.name = 'AssistError'; }
}

/** Ask for one task's suggestions. Nothing is changed: pass the ones the person accepts to apply(). */
export async function suggest(task: 'captions' | 'waits' | 'title', trace: Trace, o: AssistOptions & { ai: Ai }): Promise<{ suggestions: Suggestion[]; dropped: Dropped[] }> {
  if (task === 'waits' && !o.hints?.some((h) => h.texts.length)) return { suggestions: [], dropped: [] }; // nothing was seen to wait for
  const p = payload(task, trace, o);
  const answer = await o.ai(task, p.input, p.schema, { instructions: p.instructions });
  return toSuggestions(task, trace, answer, o);
}

/** Alt text and chapter names for a GIF or video of the guide. */
export async function describe(trace: Trace, o: AssistOptions & { ai: Ai }): Promise<ReturnType<typeof toDescription>> {
  const p = payload('describe', trace, o);
  return toDescription(trace, await o.ai('describe', p.input, p.schema, { instructions: p.instructions }));
}

export interface ProviderOptions {
  key?: string;
  /** Extra headers, or a function of the task. */
  headers?: Record<string, string> | ((task: AssistTask) => Record<string, string>);
  temperature?: number;
  /** Retries after a 429, a 5xx or no answer (backoff with jitter, or the provider's Retry-After). Default 2. */
  retries?: number;
  fetch?: typeof fetch;
}

export interface OpenAiCompatibleOptions extends ProviderOptions {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama), or a gateway's provider path. */
  baseUrl: string;
  model: string;
  /** The model for calls with images (qa), when it isn't `model`. */
  visionModel?: string;
}

export interface GeminiOptions extends ProviderOptions {
  model: string;
  /** Default https://generativelanguage.googleapis.com/v1beta. */
  baseUrl?: string;
}

const b64 = (bytes: Uint8Array): string => {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const trim = (u: string) => u.replace(/\/+$/, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Retry-After in ms: seconds or an HTTP date; null when absent or useless. */
export const retryAfterMs = (h: string | null, now = Date.now()): number | null => {
  if (!h?.trim()) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return s >= 0 ? s * 1000 : null;
  const d = Date.parse(h);
  return Number.isNaN(d) ? null : Math.max(0, d - now);
};

/**
 * POST JSON and return the parsed reply. Retries a 429, a 5xx or an unreachable server, but never a refusal
 * by the AI gateway itself (a model not on the key's list fails the same way every time).
 */
async function post(o: ProviderOptions, task: AssistTask, url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const f = o.fetch ?? globalThis.fetch;
  const tries = 1 + Math.max(0, o.retries ?? 2);
  for (let n = 1; ; n += 1) {
    const wait = (ms: number | null) => sleep(Math.min(ms ?? 400 * 2 ** (n - 1) * (0.5 + Math.random() / 2), 4000));
    let res: Response;
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...headers, ...(typeof o.headers === 'function' ? o.headers(task) : o.headers ?? {}) },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (n < tries) { await wait(null); continue; }
      throw new AssistError(`could not reach the model (${(e as Error).message})`);
    }
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { /* below */ }
    if (res.ok && json !== undefined) return json;
    const gw = json?.error?.source === 'ai-interface' ? json.error : null;
    if (!res.ok && !gw && (res.status === 429 || res.status >= 500) && n < tries) { await wait(retryAfterMs(res.headers.get('retry-after'))); continue; }
    throw new AssistError(
      gw ? `the AI gateway refused the call: ${gw.message}` : res.ok ? 'the model replied without a message' : `the model call failed (${res.status}): ${text.slice(0, 300)}`,
      res.status,
      { requestId: res.headers.get('x-ai-request-id') ?? undefined, allowed: gw?.allowed },
    );
  }
}

const answer = (content: unknown, why = 'the model replied without a message') => {
  if (typeof content !== 'string' || !content) throw new AssistError(why);
  try { return parseJsonReply(content); } catch (e) { throw new AssistError((e as Error).message); }
};

const system = (instructions: string, schema: unknown) => `${instructions}\nThe answer must match this JSON schema: ${JSON.stringify(schema)}`;

/** A provider for any OpenAI-compatible /chat/completions endpoint (JSON replies; images for qa). */
export function openAiCompatible(o: OpenAiCompatibleOptions): Ai {
  return async (task, input, schema, { instructions, images }) => {
    const user = images?.length
      ? [{ type: 'text', text: JSON.stringify(input) }, ...images.flatMap((im) => [{ type: 'text', text: im.label }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(im.png)}` } }])]
      : JSON.stringify(input);
    const json = await post(o, task, `${trim(o.baseUrl)}/chat/completions`, {
      model: images?.length ? o.visionModel ?? o.model : o.model,
      temperature: o.temperature ?? 0.2,
      response_format: { type: 'json_object' },
      // Images go in the user turn only (DeepSeek refuses one anywhere else).
      messages: [{ role: 'system', content: system(instructions, schema) }, { role: 'user', content: user }],
    });
    return answer(json?.choices?.[0]?.message?.content);
  };
}

/**
 * A provider for Gemini's own generateContent (images as inline data, before the words; JSON mode). Gemini 2.5
 * spends its thinking from the same token budget as the answer, so the budget leaves room for both.
 */
export function gemini(o: GeminiOptions & { auth?: 'header' | 'bearer' }): Ai {
  return async (task, input, schema, { instructions, images }) => {
    const parts = [
      ...(images ?? []).flatMap((im) => [{ text: im.label }, { inline_data: { mime_type: 'image/png', data: b64(im.png) } }]),
      { text: JSON.stringify(input) },
    ];
    const json = await post(
      o.auth === 'bearer' ? o : { ...o, key: undefined },
      task,
      `${trim(o.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta')}/models/${o.model}:generateContent`,
      {
        systemInstruction: { parts: [{ text: system(instructions, schema) }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: o.temperature ?? 0.2, responseMimeType: 'application/json', maxOutputTokens: 6000 },
      },
      o.auth === 'bearer' || !o.key ? {} : { 'x-goog-api-key': o.key },
    );
    const c = json?.candidates?.[0];
    return answer(
      (c?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join(''),
      c?.finishReason === 'MAX_TOKENS' ? `${o.model} spent its whole token budget thinking and gave no answer` : undefined,
    );
  };
}

/** Models used when gateway() is given none: text, then images. */
export const GATEWAY_MODELS: Record<string, [string, string?]> = {
  deepseek: ['deepseek-chat', 'deepseek-flash'],
  gemini: ['gemini-2.5-flash'],
  openai: ['gpt-4o-mini'],
};

/** Try each provider in turn; the next one only when a call fails. The last failure is thrown. */
export function firstOf(...ais: Ai[]): Ai {
  return async (...a) => {
    let last: unknown;
    for (const ai of ais) {
      try { return await ai(...a); } catch (e) { last = e; }
    }
    throw last;
  };
}

/** gateway()'s order when no provider is named: DeepSeek (usually the cheapest), then Gemini, then OpenAI. */
export const GATEWAY_ORDER = ['deepseek', 'gemini', 'openai'];

export interface GatewayOptions extends Omit<ProviderOptions, 'key' | 'headers'> {
  /**
   * The provider the gateway forwards to (its path segment), or several to try in turn. Default GATEWAY_ORDER:
   * DeepSeek, falling back to Gemini, then OpenAI.
   */
  provider?: string | string[];
  /** Default for deepseek, gemini and openai: GATEWAY_MODELS. With several providers, it applies to the first. */
  model?: string;
  /** For calls with images. Default for deepseek: deepseek-flash (deepseek-chat reads no images); otherwise `model`. */
  visionModel?: string;
  /** Default: AI_GATEWAY_URL / AI_GATEWAY_KEY from the environment (Node). */
  url?: string;
  key?: string;
  /** Spend is metered against X-AI-Feature. Default `trace-avatar-<task>`. */
  feature?: string;
}

/**
 * A provider through our AI gateway, which forwards each provider's own call: <url>/v1/<provider>/… with the
 * gateway's key. Gemini goes through generateContent, everything else through /chat/completions. Server-side
 * only: the gateway refuses calls from a browser.
 */
export function gateway(o: GatewayOptions = {}): Ai {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const url = o.url ?? env.AI_GATEWAY_URL;
  const key = o.key ?? env.AI_GATEWAY_KEY;
  if (!url || !key) throw new AssistError('the AI gateway needs a URL and a key (AI_GATEWAY_URL and AI_GATEWAY_KEY)');
  const list = typeof o.provider === 'string' ? [o.provider] : o.provider?.length ? o.provider : GATEWAY_ORDER;
  return firstOf(...list.map((provider, i) => {
    const [text, vision] = GATEWAY_MODELS[provider] ?? [];
    const own = i === 0 ? o : {};
    const model = own.model ?? text;
    if (!model) throw new AssistError(`name a model for the gateway's "${provider}"`);
    const base = { ...o, key, baseUrl: `${trim(url)}/v1/${provider}`, model, headers: (task: AssistTask) => ({ 'x-ai-feature': o.feature ?? `trace-avatar-${task}` }) };
    const visionModel = own.visionModel ?? (own.model ? undefined : vision);
    if (provider !== 'gemini') return openAiCompatible({ ...base, ...(visionModel ? { visionModel } : {}) });
    const g = gemini({ ...base, auth: 'bearer' });
    const gv = visionModel && visionModel !== model ? gemini({ ...base, model: visionModel, auth: 'bearer' }) : g;
    return ((task, input, schema, x) => (x.images?.length ? gv : g)(task, input, schema, x)) as Ai;
  }));
}
