import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { apply, chooseRepair, clearWinner, repairPayload, repairSuggestion, scoreCandidates, similarity, toRepairChoice } from '../../src/assist/index';
import type { Candidate } from '../../src/assist/index';
import type { Trace } from '../../src/core/format';

const page: Candidate[] = [
  { id: 0, role: 'link', name: 'Invoices', near: 'Menu' },
  { id: 1, role: 'button', name: 'Save invoice', key: 'save' },
  { id: 2, role: 'button', name: 'Cancel' },
  { id: 3, role: 'textbox', name: 'Customer' },
  { id: 4, role: 'button', name: 'Delete invoice' },
];
const trace = (target: Trace['steps'][number]['target'], say?: string): Trace => ({
  version: 1, meta: { title: 'Make an invoice' },
  steps: [
    { type: 'click', target: { role: 'button', name: 'New' }, say: 'Start a new invoice' },
    { type: 'type', target: { role: 'textbox', name: 'Customer' }, text: 'Grace Hopper' },
    { type: 'click', target, ...(say ? { say } : {}) },
  ],
});

describe('similarity and scores', () => {
  it('words in common, one inside the other, spelling; case, punctuation and emoji ignored', () => {
    expect(similarity('Save', 'save!')).toBe(1);
    expect(similarity('Save', 'Save invoice')).toBeCloseTo(0.9);
    expect(similarity('Colour', 'Color')).toBeGreaterThan(0.8);
    expect(similarity('💾 Save', 'Save')).toBe(1);
    expect(similarity('Save', 'Cancel')).toBeLessThan(0.4);
    expect(similarity('', 'x')).toBe(0);
    expect(similarity(undefined, undefined)).toBe(0);
  });

  it('a renamed button is a clear winner (no AI needed)', () => {
    const s = scoreCandidates({ role: 'button', name: 'Save' }, page);
    expect(s[0].id).toBe(1);
    expect(clearWinner(s)?.id).toBe(1);
  });

  it('two close names are not clear: the AI or a person decides', () => {
    const s = scoreCandidates({ role: 'button', name: 'Invoice' }, page);
    expect(s.slice(0, 2).map((x) => x.id).sort()).toEqual([1, 4]);
    expect(clearWinner(s)).toBeNull();
  });

  it('the same id or test id in the old selector counts; the same name under another role counts less', () => {
    const byKey = scoreCandidates({ sel: '[data-testid="save"]', role: 'button', name: 'Store' }, page);
    expect(byKey[0].id).toBe(1);
    const other = scoreCandidates({ role: 'button', name: 'Invoices' }, page);
    expect(other[0]).toMatchObject({ id: 0 });
    expect(other[0].score).toBeLessThan(0.8);       // a link now: not taken without a second opinion
  });

  it('nothing close: no winner; the caption can help', () => {
    expect(clearWinner(scoreCandidates({ role: 'button', name: 'Archive' }, page))).toBeNull();
    const s = scoreCandidates({ role: 'button', name: 'Submit' }, page, 'Save the invoice');
    expect(s[0].id).toBe(1);
  });
});

describe('asking the AI', () => {
  it('sends the step, the steps around it and the best candidates; never keys, nor anything typed', () => {
    const withEcho = [...page, { id: 5, role: 'heading', name: 'Invoice for Grace Hopper' }, { id: 6, role: 'button', name: 'x', near: 'Grace Hopper’s invoices' }];
    const p = repairPayload(trace({ role: 'button', name: 'Submit' }, 'Save it'), 2, withEcho, { max: 4 });
    const json = JSON.stringify(p.input);
    expect(json).not.toContain('Grace Hopper');
    expect(json).not.toContain('"key"');
    expect(json).not.toContain('save"');
    expect(p.sent).toHaveLength(4);
    expect(p.input).toMatchObject({ title: 'Make an invoice', step: { n: 3, type: 'click', say: 'Save it', was: { role: 'button', name: 'Submit' } }, after: [] });
    expect((p.input as { before: unknown[] }).before).toHaveLength(2);
  });

  it('property: no typed value ever reaches the AI, whatever the page shows', () => {
    fc.assert(fc.property(fc.string({ minLength: 3, maxLength: 12 }).filter((s) => s.trim().length >= 3), fc.array(fc.string({ maxLength: 30 }), { maxLength: 8 }), (typed, names) => {
      const t: Trace = { version: 1, steps: [{ type: 'type', target: { role: 'textbox', name: 'A' }, text: typed }, { type: 'click', target: { role: 'button', name: 'Go' } }] };
      const cands = names.map((n, i) => ({ id: i, role: 'button', name: `${n}${i % 2 ? typed : ''}` }));
      const p = repairPayload(t, 1, cands);
      return !JSON.stringify((p.input as { candidates: unknown }).candidates).toLowerCase().includes(typed.trim().toLowerCase());
    }));
  });

  it('the answer must be one of the candidates sent', () => {
    expect(toRepairChoice({ id: 2, why: ' renamed\nbutton ' }, [1, 2])).toEqual({ id: 2, why: 'renamed button' });
    expect(toRepairChoice({ id: 9 }, [1, 2])).toEqual({ id: null });
    expect(toRepairChoice({ id: null, why: 'none fit' }, [1])).toEqual({ id: null, why: 'none fit' });
    expect(toRepairChoice('nonsense', [1])).toEqual({ id: null });
  });
});

describe('chooseRepair', () => {
  it('a clear winner costs no AI call', async () => {
    const ai = vi.fn();
    const c = await chooseRepair(trace({ role: 'button', name: 'Save' }), 2, page, { ai });
    expect(c).toMatchObject({ id: 1, by: 'score' });
    expect(ai).not.toHaveBeenCalled();
  });
  it('unsure: the AI chooses (task "repair", with the page image only when given); without one, the top 3', async () => {
    const ai = vi.fn(async () => ({ id: 4, why: 'deleting is what the caption says' }));
    const t = trace({ role: 'button', name: 'Invoice' }, 'Delete the invoice');
    const img = { png: new Uint8Array([1]), label: 'the page now' };
    expect(await chooseRepair(t, 2, page, { ai, image: img })).toMatchObject({ id: 4, by: 'ai', why: 'deleting is what the caption says' });
    expect((ai.mock.calls[0] as unknown[])[0]).toBe('repair');
    expect((ai.mock.calls[0] as unknown[])[3]).toMatchObject({ images: [img] });
    const none = await chooseRepair(t, 2, page);
    expect(none).toMatchObject({ id: null, by: 'none' });
    expect(none.top).toHaveLength(3);
    const no = await chooseRepair(t, 2, page, { ai: async () => ({ id: null }) });
    expect(no.id).toBeNull();
  });
});

describe('a repair as a suggestion', () => {
  it('apply() puts the new target in; the trace stays valid; rejecting changes nothing', () => {
    const t = trace({ role: 'button', name: 'Save', sel: '#save' });
    const s = repairSuggestion(t, 2, { sel: '[data-testid="save"]', role: 'button', name: 'Save invoice' }, { why: 'renamed', verified: true });
    expect(s).toEqual({ task: 'repair', kind: 'target', index: 2, value: 'button “Save invoice”', before: 'button “Save”', target: { sel: '[data-testid="save"]', role: 'button', name: 'Save invoice' }, why: 'renamed', verified: true });
    const next = apply(t, [s]);
    expect(next.steps[2].target).toEqual(s.target);
    expect(next.steps[0]).toEqual(t.steps[0]);
    expect(apply(t, [])).toEqual(t);
  });
});
