import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { apply, describe as describeGuide, firstOf, gateway, gemini, openAiCompatible, retryAfterMs, parseJsonReply, preview, suggest, toSuggestions, AssistError } from '../../src/assist/index';
import type { Ai } from '../../src/assist/index';
import type { Trace } from '../../src/core/format';
import { validate } from '../../src/core/format';

const trace = (): Trace => ({
  version: 1,
  meta: { title: 'Invoice' },
  steps: [
    { type: 'click', t: 0, page: '/invoices', target: { sel: '#new-42-ada', role: 'button', name: 'New invoice' } },
    { type: 'type', t: 800, target: { sel: '#customer', role: 'textbox', name: 'Customer' }, text: 'Ada Lovelace' },
    { type: 'type', t: 1600, target: { sel: '#pin', role: 'textbox', name: 'PIN' }, text: '••••', mask: true },
    { type: 'click', t: 2400, target: { sel: '#send', role: 'button', name: 'Send' }, say: 'Send it' },
    { type: 'click', t: 4000, target: { role: 'link', name: 'Done' } },
  ],
});
const hints = [{ after: 3, texts: ['Sending…', 'Sent to Ada Lovelace'] }];
const fake = (answer: unknown): Ai & { calls: unknown[][] } => {
  const calls: unknown[][] = [];
  const f = (async (...a: unknown[]) => { calls.push(a); return answer; }) as Ai & { calls: unknown[][] };
  f.calls = calls;
  return f;
};

describe('what is sent', () => {
  it('steps in words (role + name, page, captions), never typed text or selectors; masked marked', () => {
    const p = preview('captions', trace());
    const json = JSON.stringify(p.input);
    expect(json).not.toContain('Ada Lovelace');
    expect(json).not.toContain('#new-42-ada');
    expect(json).not.toContain('#customer');
    expect((p.input as { steps: unknown[] }).steps[0]).toEqual({ n: 1, type: 'click', on: 'button “New invoice”', page: '/invoices', at: 0 });
    expect((p.input as { steps: Array<Record<string, unknown>> }).steps[2]).toMatchObject({ masked: true });
    expect((p.input as { steps: Array<Record<string, unknown>> }).steps[4]).toMatchObject({ page: '/invoices' }); // carried on
    // Typed text only on request, and never a masked field's.
    const typed = JSON.stringify(preview('captions', trace(), { sendTyped: true }).input);
    expect(typed).toContain('Ada Lovelace');
    expect(typed).not.toContain('••••');
    expect(p.instructions).toContain('JSON');
    expect(p.schema).toMatchObject({ required: ['steps'] });
  });

  it('never a typed or masked value, nor a selector, for any trace (property)', () => {
    const secret = fc.string({ minLength: 6, maxLength: 12 }).map((s) => `SECRET${s}`);
    fc.assert(fc.property(fc.array(fc.record({ text: secret, mask: fc.boolean(), sel: secret }), { minLength: 1, maxLength: 6 }), (rows) => {
      const t: Trace = { version: 1, steps: rows.map((r) => ({ type: 'type' as const, target: { sel: `#${r.sel}`, name: 'Field' }, text: r.text, ...(r.mask ? { mask: true } : {}) })) };
      for (const task of ['captions', 'waits', 'title', 'describe'] as const) {
        expect(JSON.stringify(preview(task, t, { hints: [] }).input)).not.toContain('SECRET');
      }
      const opted = JSON.stringify(preview('captions', t, { sendTyped: true }).input);
      for (const r of rows) if (r.mask) expect(opted).not.toContain(r.text.slice(0, 20));
    }), { numRuns: 60 });
  });

  it('waits send what appeared after steps (numbered from 1), trimmed', () => {
    const p = preview('waits', trace(), { hints: [{ after: 3, texts: ['  Sent   to Ada ', 'x'.repeat(80)] }] });
    expect((p.input as { appeared: unknown }).appeared).toEqual([{ after: 4, appeared: ['Sent to Ada', 'x'.repeat(60)] }]);
  });
});

describe('suggestions', () => {
  it('captions: one per step, checked; unchanged ones skipped; bad ones dropped with a reason', async () => {
    const ai = fake({ steps: [
      { n: 1, say: 'Start a  new invoice' }, { n: 4, say: 'Send it' }, { n: 2, say: 'x'.repeat(141) },
      { n: 9, say: 'nope' }, { n: 3, say: '' }, { n: 1, say: 'again' },
    ] });
    const r = await suggest('captions', trace(), { ai, tone: 'terse' });
    expect(r.suggestions).toEqual([{ task: 'captions', kind: 'say', index: 0, value: 'Start a new invoice' }]);
    expect(r.dropped.map((d) => d.why)).toEqual(['longer than 140 characters', 'no such step', 'no caption text', 'a second caption for the same step']);
    expect(ai.calls[0][0]).toBe('captions');
    expect((ai.calls[0][3] as { instructions: string }).instructions).toContain('short and direct');
  });

  it('waits: only for a text the page really showed after that step', async () => {
    const ai = fake({ waits: [{ after: 4, text: 'Sent to Ada', why: 'sending takes a moment' }, { after: 2, text: 'Saved' }, { after: 4, text: 'Invented' }] });
    const r = await suggest('waits', trace(), { ai, hints });
    expect(r.suggestions).toEqual([{ task: 'waits', kind: 'wait', index: 3, value: 'Sent to Ada', why: 'sending takes a moment' }]);
    expect(r.dropped.map((d) => d.why)).toEqual(['that text did not appear after the step', 'that text did not appear after the step']);
    // With nothing seen, no model call at all.
    const none = fake({ waits: [] });
    expect(await suggest('waits', trace(), { ai: none })).toEqual({ suggestions: [], dropped: [] });
    expect(none.calls).toHaveLength(0);
  });

  it('title: one, capped; the same title is no suggestion', async () => {
    expect((await suggest('title', trace(), { ai: fake({ title: 'Send an invoice' }) })).suggestions).toEqual([{ task: 'title', kind: 'title', index: -1, value: 'Send an invoice', before: 'Invoice' }]);
    expect((await suggest('title', trace(), { ai: fake({ title: 'Invoice' }) })).suggestions).toEqual([]);
    expect((await suggest('title', trace(), { ai: fake({ title: 'x'.repeat(81) }) })).dropped[0].why).toContain('80');
    expect(toSuggestions('title', trace(), 'nonsense').dropped[0].why).toBe('no title');
    expect(toSuggestions('captions', trace(), { nope: 1 }).dropped[0].why).toContain('"steps"');
  });

  it('apply: accepted ones only, a valid trace, waits inserted after their steps; rejecting changes nothing', () => {
    const t = trace();
    const before = JSON.stringify(t);
    const next = apply(t, [
      { task: 'waits', kind: 'wait', index: 3, value: 'Sent to Ada' },
      { task: 'captions', kind: 'say', index: 4, value: 'All done' },
      { task: 'waits', kind: 'wait', index: 0, value: 'New invoice' },
      { task: 'title', kind: 'title', index: -1, value: 'Send an invoice' },
    ]);
    expect(JSON.stringify(t)).toBe(before); // the input is untouched
    expect(validate(next).ok).toBe(true);
    expect(next.meta?.title).toBe('Send an invoice');
    expect(next.steps.map((s) => s.type)).toEqual(['click', 'wait', 'type', 'type', 'click', 'wait', 'click']);
    expect(next.steps[5]).toEqual({ type: 'wait', until: { text: 'Sent to Ada' }, timeout: 15000 });
    expect(next.steps[6].say).toBe('All done');
    expect(JSON.stringify(apply(t, []))).toBe(before);
  });

  it('describe: alt text and chapters, checked', async () => {
    const r = await describeGuide(trace(), { ai: fake({ alt: 'A cursor makes an invoice', chapters: [{ n: 4, name: 'Send' }, { n: 1, name: 'Start' }, { n: 99, name: 'x' }] }) });
    expect(r.alt).toBe('A cursor makes an invoice');
    expect(r.chapters).toEqual([{ index: 0, name: 'Start' }, { index: 3, name: 'Send' }]);
    expect(r.dropped).toHaveLength(1);
  });

  it('parses JSON replies with fences or text around them', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseJsonReply('no')).toThrow('did not reply with JSON');
  });
});

describe('providers', () => {
  const reply = (content: string, status = 200) => vi.fn(async () => new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : 'quota', { status }));

  it('openAiCompatible: POST /chat/completions with the key, JSON mode, the schema in the instructions; images as data URLs', async () => {
    const f = reply('{"title":"Send an invoice"}');
    const ai = openAiCompatible({ baseUrl: 'http://localhost:11434/v1/', key: 'k1', model: 'llama3', headers: { 'x-extra': '1' }, fetch: f as unknown as typeof fetch });
    expect(await ai('title', { a: 1 }, { type: 'object' }, { instructions: 'Name it.', images: [{ png: new Uint8Array([137, 80, 78, 71]), label: 'frame 1' }] })).toEqual({ title: 'Send an invoice' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer k1', 'x-extra': '1', 'content-type': 'application/json' });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'llama3', response_format: { type: 'json_object' } });
    expect(body.messages[0].content).toContain('Name it.');
    expect(body.messages[0].content).toContain('{"type":"object"}');
    expect(body.messages[1].content[2]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } });
  });

  it('errors: a failed call (with its status), a reply without a message, a reply that is not JSON', async () => {
    const go = (f: unknown) => openAiCompatible({ baseUrl: 'http://x', model: 'm', retries: 0, fetch: f as typeof fetch })('title', {}, {}, { instructions: '' });
    const e = await go(reply('', 429)).catch((x: unknown) => x) as AssistError;
    expect(e).toBeInstanceOf(AssistError);
    expect(e).toMatchObject({ status: 429 });
    expect(e.message).toContain('quota');
    expect((await go(vi.fn(async () => new Response('{}'))).catch((x: Error) => x) as Error).message).toContain('without a message');
    expect((await go(reply('I think the title is nice')).catch((x: Error) => x) as Error).message).toContain('JSON');
  });

  it('gateway: <url>/v1/<provider>, the gateway key, X-AI-Feature per task; from the environment by default; never without a key', async () => {
    const f = reply('{"title":"t"}');
    await gateway({ url: 'https://gw.example/', key: 'aik_1', provider: 'deepseek', model: 'deepseek-chat', fetch: f as unknown as typeof fetch })('title', {}, {}, { instructions: '' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw.example/v1/deepseek/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer aik_1', 'x-ai-feature': 'trace-avatar-title' });
    const g = reply('{"x":1}');
    vi.stubEnv('AI_GATEWAY_URL', 'https://env.gw');
    vi.stubEnv('AI_GATEWAY_KEY', 'aik_env');
    await gateway({ provider: 'openai', model: 'gpt-4o-mini', feature: 'docs-qa', fetch: g as unknown as typeof fetch })('qa', {}, {}, { instructions: '' });
    expect((g.mock.calls[0] as unknown as [string])[0]).toBe('https://env.gw/v1/openai/chat/completions');
    expect((g.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ authorization: 'Bearer aik_env', 'x-ai-feature': 'docs-qa' });
    vi.stubEnv('AI_GATEWAY_KEY', '');
    expect(() => gateway({ model: 'm' })).toThrow('AI_GATEWAY_URL and AI_GATEWAY_KEY');
    vi.unstubAllEnvs();
  });

  // A fetch that answers from a list, one per call, and keeps what it was sent.
  const seq = (...rs: Array<[number, unknown, Record<string, string>?] | Error>) => {
    const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
    const f = async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: JSON.parse(String(init.body)) });
      const r = rs[Math.min(calls.length, rs.length) - 1];
      if (r instanceof Error) throw r;
      return new Response(typeof r[1] === 'string' ? r[1] : JSON.stringify(r[1]), { status: r[0], headers: r[2] ?? {} });
    };
    return { f: f as unknown as typeof fetch, calls };
  };
  const chat = (content: string) => ({ choices: [{ message: { content } }] });
  const gem = (text: string, finishReason = 'STOP') => ({ candidates: [{ content: { parts: text ? [{ text }] : [] }, finishReason }] });
  const IMG = [{ png: new Uint8Array([1, 2, 3]), label: 'after step 1' }];

  it('retries a 429 or 5xx (following Retry-After) and an unreachable server; then gives up with the status and request id', async () => {
    const a = seq([503, 'busy', { 'retry-after': '0' }], [429, 'slow down', { 'retry-after': '0' }], [200, chat('{"title":"t"}')]);
    expect(await openAiCompatible({ baseUrl: 'http://x', model: 'm', fetch: a.f })('title', {}, {}, { instructions: '' })).toEqual({ title: 't' });
    expect(a.calls).toHaveLength(3);
    const b = seq([500, 'down', { 'retry-after': '0', 'x-ai-request-id': 'req_9' }]);
    const e = await openAiCompatible({ baseUrl: 'http://x', model: 'm', retries: 1, fetch: b.f })('title', {}, {}, { instructions: '' }).catch((x: AssistError) => x);
    expect(b.calls).toHaveLength(2);
    expect(e).toMatchObject({ status: 500, info: { requestId: 'req_9' } });
    const c = seq(new TypeError('fetch failed'), [200, chat('{"title":"t"}')]);
    expect(await openAiCompatible({ baseUrl: 'http://x', model: 'm', retries: 1, fetch: c.f })('title', {}, {}, { instructions: '' })).toEqual({ title: 't' });
    const d = seq(new TypeError('fetch failed'));
    await expect(openAiCompatible({ baseUrl: 'http://x', model: 'm', retries: 0, fetch: d.f })('title', {}, {}, { instructions: '' })).rejects.toThrow('could not reach the model (fetch failed)');
    // A 400 is the caller's mistake: no retry.
    const g = seq([400, 'bad']);
    await expect(openAiCompatible({ baseUrl: 'http://x', model: 'm', fetch: g.f })('title', {}, {}, { instructions: '' })).rejects.toThrow('(400)');
    expect(g.calls).toHaveLength(1);
  });

  it('never retries a refusal by the gateway itself, and says which models the key allows', async () => {
    const a = seq([403, { error: { source: 'ai-interface', message: 'model not allowed', allowed: ['deepseek-chat'] } }, { 'x-ai-request-id': 'req_1' }]);
    const e = await gateway({ url: 'https://gw', key: 'k', provider: 'deepseek', fetch: a.f })('title', {}, {}, { instructions: '' }).catch((x: unknown) => x) as AssistError;
    expect(a.calls).toHaveLength(1);
    expect(e).toBeInstanceOf(AssistError);
    expect(e.message).toContain('the AI gateway refused the call: model not allowed');
    expect(e).toMatchObject({ status: 403, info: { requestId: 'req_1', allowed: ['deepseek-chat'] } });
  });

  it('Retry-After: seconds or an HTTP date; nothing useful is null', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', Date.parse('Thu, 01 Jan 2026 00:00:00 GMT'))).toBe(5000);
    for (const h of [null, '', ' ', '-1', 'soon']) expect(retryAfterMs(h)).toBeNull();
  });

  it('gemini: generateContent with the key in a header, images as inline data before the words, JSON mode, room to think', async () => {
    const a = seq([200, gem('{"flags":[]}')]);
    expect(await gemini({ key: 'g1', model: 'gemini-2.5-flash', fetch: a.f })('qa', { n: 1 }, { type: 'object' }, { instructions: 'Look.', images: IMG })).toEqual({ flags: [] });
    const { url, init, body } = a.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'g1' });
    expect(init.headers).not.toHaveProperty('authorization');
    expect(body.systemInstruction.parts[0].text).toContain('Look.');
    expect(body.contents[0].parts).toEqual([{ text: 'after step 1' }, { inline_data: { mime_type: 'image/png', data: 'AQID' } }, { text: '{"n":1}' }]);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(4000);
    const b = seq([200, gem('', 'MAX_TOKENS')]);
    await expect(gemini({ key: 'g', model: 'gemini-2.5-flash', fetch: b.f })('title', {}, {}, { instructions: '' })).rejects.toThrow('spent its whole token budget thinking');
    const c = seq([200, gem('')]);
    await expect(gemini({ key: 'g', model: 'm', fetch: c.f })('title', {}, {}, { instructions: '' })).rejects.toThrow('without a message');
  });

  it('gateway: DeepSeek by default (deepseek-chat; deepseek-flash for images), falling back to Gemini, then OpenAI', async () => {
    const a = seq([200, chat('{"title":"t"}')]);
    const ai = gateway({ url: 'https://gw', key: 'k', fetch: a.f });
    await ai('title', {}, {}, { instructions: '' });
    await ai('qa', {}, {}, { instructions: '', images: IMG });
    expect(a.calls.map((c) => [c.url, c.body.model])).toEqual([
      ['https://gw/v1/deepseek/chat/completions', 'deepseek-chat'],
      ['https://gw/v1/deepseek/chat/completions', 'deepseek-flash'],
    ]);
    expect(a.calls[1].body.messages[1].content[2].type).toBe('image_url');
    // DeepSeek fails (after its retries) → Gemini through the gateway, with the gateway key as a Bearer.
    const b = seq([400, 'no'], [200, gem('{"title":"g"}')]);
    expect(await gateway({ url: 'https://gw', key: 'k', fetch: b.f })('title', {}, {}, { instructions: '' })).toEqual({ title: 'g' });
    expect(b.calls[1].url).toBe('https://gw/v1/gemini/models/gemini-2.5-flash:generateContent');
    expect(b.calls[1].init.headers).toMatchObject({ authorization: 'Bearer k', 'x-ai-feature': 'trace-avatar-title' });
    expect(b.calls[1].init.headers).not.toHaveProperty('x-goog-api-key');
    // … then OpenAI.
    const c = seq([400, 'no'], [400, 'no'], [200, chat('{"title":"o"}')]);
    expect(await gateway({ url: 'https://gw', key: 'k', fetch: c.f })('title', {}, {}, { instructions: '' })).toEqual({ title: 'o' });
    expect(c.calls.map((x) => [x.url, x.body.model])).toEqual([
      ['https://gw/v1/deepseek/chat/completions', 'deepseek-chat'],
      ['https://gw/v1/gemini/models/gemini-2.5-flash:generateContent', undefined],
      ['https://gw/v1/openai/chat/completions', 'gpt-4o-mini'],
    ]);
    // All fail: the last failure is what's thrown.
    const d = seq([400, 'no']);
    await expect(gateway({ url: 'https://gw', key: 'k', fetch: d.f })('title', {}, {}, { instructions: '' })).rejects.toThrow('(400)');
    expect(d.calls).toHaveLength(3);
  });

  it('gateway: a named provider or order; a named model is used for images too unless a vision model is given', async () => {
    const a = seq([200, chat('{"title":"t"}')]);
    await gateway({ url: 'https://gw', key: 'k', provider: 'deepseek', model: 'deepseek-v4-pro', visionModel: 'deepseek-flash', fetch: a.f })('qa', {}, {}, { instructions: '', images: IMG });
    expect(a.calls[0].body.model).toBe('deepseek-flash');
    const b = seq([200, chat('{"title":"t"}')]);
    await gateway({ url: 'https://gw', key: 'k', provider: 'openai', model: 'gpt-4o', fetch: b.f })('qa', {}, {}, { instructions: '', images: IMG });
    expect(b.calls[0].body.model).toBe('gpt-4o');
    const c = seq([200, gem('{"title":"g"}')]);
    await gateway({ url: 'https://gw', key: 'k', provider: ['gemini', 'openai'], fetch: c.f })('qa', {}, {}, { instructions: '', images: IMG });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].url).toContain('/v1/gemini/models/gemini-2.5-flash:generateContent');
    expect(() => gateway({ url: 'https://gw', key: 'k', provider: 'mistral' })).toThrow('name a model for the gateway\'s "mistral"');
    expect(typeof gateway({ url: 'https://gw', key: 'k', provider: 'mistral', model: 'mistral-small' })).toBe('function');
  });

  it('firstOf: the next only when one fails', async () => {
    const ok = vi.fn(async () => ({ a: 1 }));
    const bad = vi.fn(async () => { throw new Error('x'); });
    expect(await firstOf(bad, ok, bad)('title', {}, {}, { instructions: '' })).toEqual({ a: 1 });
    expect(bad).toHaveBeenCalledTimes(1);
    await expect(firstOf(bad, bad)('title', {}, {}, { instructions: '' })).rejects.toThrow('x');
  });
});
