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

export class AssistError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = 'AssistError'; }
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

export interface OpenAiCompatibleOptions {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama), or a gateway's provider path. */
  baseUrl: string;
  key?: string;
  model: string;
  /** Extra headers, or a function of the task. */
  headers?: Record<string, string> | ((task: AssistTask) => Record<string, string>);
  temperature?: number;
  fetch?: typeof fetch;
}

const b64 = (bytes: Uint8Array): string => {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** A provider for any OpenAI-compatible /chat/completions endpoint (JSON replies; images for qa). */
export function openAiCompatible(o: OpenAiCompatibleOptions): Ai {
  const f = o.fetch ?? globalThis.fetch;
  return async (task, input, schema, { instructions, images }) => {
    const user = images?.length
      ? [{ type: 'text', text: JSON.stringify(input) }, ...images.flatMap((im) => [{ type: 'text', text: im.label }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(im.png)}` } }])]
      : JSON.stringify(input);
    const res = await f(`${o.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(o.key ? { authorization: `Bearer ${o.key}` } : {}),
        ...(typeof o.headers === 'function' ? o.headers(task) : o.headers ?? {}),
      },
      body: JSON.stringify({
        model: o.model,
        temperature: o.temperature ?? 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${instructions}\nThe answer must match this JSON schema: ${JSON.stringify(schema)}` },
          { role: 'user', content: user },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new AssistError(`the model call failed (${res.status}): ${text.slice(0, 300)}`, res.status);
    let content: unknown;
    try { content = JSON.parse(text)?.choices?.[0]?.message?.content; } catch { /* below */ }
    if (typeof content !== 'string') throw new AssistError('the model replied without a message');
    try { return parseJsonReply(content); } catch (e) { throw new AssistError((e as Error).message); }
  };
}

export interface GatewayOptions {
  /** The provider the gateway forwards to (its path segment). Default 'deepseek'. */
  provider?: string;
  model: string;
  /** Default: AI_GATEWAY_URL / AI_GATEWAY_KEY from the environment (Node). */
  url?: string;
  key?: string;
  /** Spend is metered against X-AI-Feature. Default `trace-avatar-<task>`. */
  feature?: string;
  fetch?: typeof fetch;
}

/** A provider through an AI gateway that forwards provider-native calls: <url>/v1/<provider>/chat/completions. */
export function gateway(o: GatewayOptions): Ai {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const url = o.url ?? env.AI_GATEWAY_URL;
  const key = o.key ?? env.AI_GATEWAY_KEY;
  if (!url || !key) throw new AssistError('the AI gateway needs a URL and a key (AI_GATEWAY_URL and AI_GATEWAY_KEY)');
  return openAiCompatible({
    baseUrl: `${url.replace(/\/+$/, '')}/v1/${o.provider ?? 'deepseek'}`,
    key,
    model: o.model,
    headers: (task) => ({ 'x-ai-feature': o.feature ?? `trace-avatar-${task}` }),
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
}

