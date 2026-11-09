import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { apply, describe as describeGuide, gateway, openAiCompatible, parseJsonReply, preview, suggest, toSuggestions, AssistError } from '../../src/assist/index';
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
    const go = (f: unknown) => openAiCompatible({ baseUrl: 'http://x', model: 'm', fetch: f as typeof fetch })('title', {}, {}, { instructions: '' });
    const e = await go(reply('', 429)).catch((x: unknown) => x) as AssistError;
    expect(e).toBeInstanceOf(AssistError);
    expect(e).toMatchObject({ status: 429 });
    expect(e.message).toContain('quota');
    expect((await go(vi.fn(async () => new Response('{}'))).catch((x: Error) => x) as Error).message).toContain('without a message');
    expect((await go(reply('I think the title is nice')).catch((x: Error) => x) as Error).message).toContain('JSON');
  });

  it('gateway: <url>/v1/<provider>, the gateway key, X-AI-Feature per task; from the environment by default; never without a key', async () => {
    const f = reply('{"title":"t"}');
    await gateway({ url: 'https://gw.example/', key: 'aik_1', model: 'deepseek-chat', fetch: f as unknown as typeof fetch })('title', {}, {}, { instructions: '' });
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
});
