// @vitest-environment happy-dom
/**
 * E8: a wait whose text changed. Choosing the new text (code first, AI only when unsure), the suggestion
 * apply() takes, removing a wait, the page's texts (textsOf) and the player's check (untilHolds).
 */
import { describe, expect, it, vi } from 'vitest';
import { GUESS_MIN, apply, chooseWait, guessWait, removeStep, scoreTexts, toWaitChoice, waitPayload, waitSuggestion } from '../../src/assist/index';
import type { TextCandidate } from '../../src/assist/index';
import { elementOf, scopeFor, textsOf, untilHolds } from '../../src/repair/index';
import type { Trace } from '../../src/core/format';
import { html, setRect } from './dom-helpers';

const T: Trace = {
  version: 1,
  meta: { title: 'Save an invoice' },
  steps: [
    { type: 'type', target: { role: 'textbox', name: 'Customer' }, text: 'Ada Stores' },
    { type: 'click', target: { role: 'button', name: 'Save' }, say: 'Save it' },
    { type: 'wait', until: { text: 'Saved' }, say: 'Saving…' },
    { type: 'note', say: 'Done' },
  ],
};
const texts = (...t: Array<string | [string, true]>): TextCandidate[] => t.map((x, id) => (Array.isArray(x) ? { id, text: x[0], recent: true } : { id, text: x }));

describe('scoring and choosing a wait’s new text', () => {
  it('“Saved” → “Changes saved” is a clear winner with no AI; recent texts get a bonus', async () => {
    const list = texts('Invoices', 'Changes saved', 'Total');
    expect(scoreTexts('Saved', list)[0]).toEqual({ id: 1, score: 0.9 });
    expect(scoreTexts('Saved', texts('Invoices', ['Changes saved', true]))[0]).toEqual({ id: 1, score: 1 });
    const ai = vi.fn();
    expect(await chooseWait(T, 2, list, { ai })).toMatchObject({ id: 1, text: 'Changes saved', by: 'score' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('unsure: the AI is asked with no typed values, and its answer must be on the page', async () => {
    const list = texts('Invoice stored', 'Saved Ada Stores', 'Payment received');
    const p = waitPayload(T, 2, list);
    expect(JSON.stringify(p.input)).not.toMatch(/ada stores/i);
    expect(p.sent).not.toContain(1);
    expect(p.input).toMatchObject({ step: { n: 3, waited_for: 'Saved', say: 'Saving…' }, after: [{ n: 4, type: 'note' }] });
    const ai = vi.fn(async () => ({ id: 0, why: 'stored means saved' }));
    expect(await chooseWait(T, 2, list, { ai })).toMatchObject({ id: 0, text: 'Invoice stored', by: 'ai', why: 'stored means saved' });
    expect(ai).toHaveBeenCalledWith('repair-wait', p.input, p.schema, { instructions: p.instructions });
    expect(await chooseWait(T, 2, list)).toMatchObject({ id: null, by: 'none' });
    // A typed value is never chosen, even by a model.
    expect(await chooseWait(T, 2, list, { ai: async () => ({ id: 1 }) })).toMatchObject({ id: null, by: 'none' });
  });

  it('a part of a text is kept as the page wrote it; text not in the candidate, or an unsent id, is dropped', () => {
    const list = texts('Invoice 12 STORED at 14:02', 'Other');
    expect(toWaitChoice({ id: 0, text: ' stored ' }, [0, 1], list)).toEqual({ id: 0, text: 'STORED' });
    expect(toWaitChoice({ id: 0, text: 'Saved!' }, [0, 1], list)).toEqual({ id: null });
    expect(toWaitChoice({ id: 7 }, [0, 1], list)).toEqual({ id: null });
    expect(toWaitChoice({ id: 1 }, [0], list)).toEqual({ id: null });
    expect(toWaitChoice('nonsense', [0], list)).toEqual({ id: null });
  });
});

describe('the fix as a suggestion, and removing a wait', () => {
  it("apply() takes kind 'until': the step waits for the new text", () => {
    const s = waitSuggestion(T, 2, 'Changes saved', { verified: true, why: 'renamed' });
    expect(s).toEqual({ task: 'repair', kind: 'until', index: 2, value: 'Changes saved', before: 'Saved', why: 'renamed', verified: true });
    const out = apply(T, [s]);
    expect(out.steps[2]).toEqual({ type: 'wait', until: { text: 'Changes saved' }, say: 'Saving…' });
    expect(T.steps[2].until).toEqual({ text: 'Saved' });
  });

  it('removeStep drops the wait and moves its caption to the next step only when that has none', () => {
    expect(removeStep(T, 2).steps.map((s) => s.say)).toEqual([undefined, 'Save it', 'Done']);
    const bare: Trace = { ...T, steps: [...T.steps.slice(0, 3), { type: 'click', target: { text: 'Next' } }] };
    expect(removeStep(bare, 2).steps[2]).toEqual({ type: 'click', target: { text: 'Next' }, say: 'Saving…' });
    expect(removeStep(T, 3).steps).toHaveLength(3);
  });
});

describe('textsOf: what a wait could wait for now', () => {
  it('short text blocks in page order, the whole block when it is short; skips fields, controls, masked, ignored, blurred and the guide', () => {
    html(`<h2>Invoices</h2><button>Save</button><a href="#">Help</a><div role="button">Go</div><label>Name</label><p>Changes <b>saved</b></p><p>${'long words '.repeat(10)}<i>tail</i></p>
      <input value="typed here"><textarea>notes</textarea><div contenteditable="true">edit me</div>
      <div data-trace-mask>secret code</div><div data-trace-ignore>ignored</div><div data-trace-blur>blurred</div>
      <div data-trace-avatar>Looking for “Saved”…</div><p>x</p>`);
    const list = textsOf(document);
    expect(list.map((c) => c.text)).toEqual(['Invoices', 'Changes saved', 'tail']);
    expect(elementOf(1)!.tagName).toBe('P');
  });

  it('hidden text is not offered; the scope limits it to the wait’s target', () => {
    html('<div id="status"><span>Running</span></div><p id="h">Hidden</p><p>Elsewhere</p>');
    setRect(document.getElementById('h')!, 0, 0, 0, 0);
    expect(textsOf(document).map((c) => c.text)).toEqual(['Running', 'Elsewhere']);
    expect(textsOf(document.getElementById('status')!).map((c) => c.text)).toEqual(['Running']);
  });

  it('seen texts come first as recent; one no longer on the page is gone, with no element', () => {
    html('<p>Invoices</p><p>Changes saved</p>');
    const list = textsOf(document, { seen: ['Changes saved', 'Invoice stored', 'Changes saved'] });
    expect(list).toEqual([
      { id: 0, text: 'Changes saved', recent: true },
      { id: 1, text: 'Invoice stored', recent: true, gone: true },
      { id: 2, text: 'Invoices' },
    ]);
    expect(elementOf(0)!.textContent).toBe('Changes saved');
    expect(elementOf(1)).toBeNull();
  });

  it('a seen text whose element is a field, a control, masked or ignored is dropped; strings are taken as they are', () => {
    html('<button id="b">Save</button><p id="m" data-trace-mask>Code 1234</p><p id="ok">Invoice stored</p>');
    const el = (id: string) => document.getElementById(id)!;
    const list = textsOf(document, { seen: [{ text: 'Save', element: el('b') }, { text: 'Code 1234', element: el('m') }, { text: 'Invoice stored', element: el('ok') }, 'Changes stored'] });
    expect(list.filter((c) => c.recent).map((c) => c.text)).toEqual(['Invoice stored', 'Changes stored']);
  });

  it('never offers a text holding a typed value, or the value of a masked field; a revealed field’s value is fine', () => {
    html('<p>Saved Ada Stores</p><p>Hello sk-12345</p><p>Demo co</p><p>OK</p><input type="password" value="sk-12345"><div data-trace-reveal><input value="Demo co"></div>');
    expect(textsOf(document, { typed: ['ada stores'] }).map((c) => c.text)).toEqual(['Demo co', 'OK']);
  });

  it('stops at max', () => {
    html(Array.from({ length: 20 }, (_, i) => `<p>Item ${i}</p>`).join(''));
    expect(textsOf(document, { max: 5 })).toHaveLength(5);
  });
});

describe('untilHolds: the player’s own check', () => {
  it('on the page without a target; inside the target with one', () => {
    html('<div id="status">Status: running</div><p>Changes saved</p>');
    expect(untilHolds('changes SAVED', undefined)).toBe(true);
    expect(untilHolds('Saved!', undefined)).toBe(false);
    expect(untilHolds('running', { sel: '#status' })).toBe(true);
    expect(untilHolds('Changes saved', { sel: '#status' })).toBe(false);
    expect(untilHolds('running', { sel: '#gone' })).toBe(false);
    expect(untilHolds('  ', undefined)).toBe(false);
  });
});

describe('guessWait: what to offer when nothing is sure', () => {
  const choice = (o: { id?: number | null; text?: string; top?: Array<[number, number]> }) =>
    ({ id: o.id ?? null, ...(o.text ? { text: o.text } : {}), by: o.id != null ? 'score' : 'none', top: (o.top ?? []).map(([id, score]) => ({ id, score })) }) as never;

  it('a choice is taken as it is, not a guess', () => {
    expect(guessWait(choice({ id: 1, text: 'stored', top: [[1, 0.9]] }), texts('Invoices', 'Changes stored'))).toEqual({ id: 1, text: 'stored', guess: false });
  });

  it('else the best text when it scores at least GUESS_MIN; else what showed most recently; else nothing', () => {
    expect(GUESS_MIN).toBe(0.5);
    const list = texts('Saved at 10:02', ['Changes stored', true]);
    expect(guessWait(choice({ top: [[0, 0.6], [1, 0.4]] }), list)).toEqual({ id: 0, text: 'Saved at 10:02', guess: true });
    expect(guessWait(choice({ top: [[0, 0.3], [1, 0.4]] }), list)).toEqual({ id: 1, text: 'Changes stored', guess: true });
    expect(guessWait(choice({ top: [[0, 0.3]] }), texts('Invoices'))).toBeNull();
  });
});

describe('scopeFor: where a wait looks', () => {
  it('the target’s element when found, else the page', () => {
    html('<div id="status">Running</div>');
    expect(scopeFor({ sel: '#status' })).toBe(document.getElementById('status'));
    expect(scopeFor({ sel: '#gone' })).toBe(document);
    expect(scopeFor(undefined)).toBe(document);
  });
});
