import { describe, expect, it } from 'vitest';
import { compactPages, entryOf, expandPages, guideId, moveStep, pagesOf, removeStep, stepLabel } from '../../src/core/review';
import { validateManifest } from '../../src/core/manifest';
import type { Step } from '../../src/core/format';

const steps: Step[] = [
  { type: 'click', t: 100, page: '/a', target: { sel: '#new', name: 'New invoice' } },
  { type: 'type', t: 900, target: { sel: '#customer', name: 'Customer' }, text: 'Ada' },
  { type: 'click', t: 1500, page: '/b', target: { sel: '#save' } },
];

describe('review helpers', () => {
  it('expands and compacts pages without changing the input', () => {
    const e = expandPages(steps);
    expect(e.map((s) => s.page)).toEqual(['/a', '/a', '/b']);
    expect(steps[1].page).toBeUndefined();
    expect(compactPages(e)).toEqual(steps);
    expect(expandPages([{ type: 'note', say: 'hi' }])).toEqual([{ type: 'note', say: 'hi' }]);
    expect(pagesOf(e)).toEqual(['/a', '/b']);
  });

  it('moves a step, keeping the times in place; out of range changes nothing', () => {
    const m = moveStep(expandPages(steps), 2, -1);
    expect(m.map((s) => [s.target?.sel, s.t, s.page])).toEqual([['#new', 100, '/a'], ['#save', 900, '/b'], ['#customer', 1500, '/a']]);
    expect(compactPages(m).map((s) => s.page)).toEqual(['/a', '/b', '/a']);
    expect(moveStep(steps, 0, -1)).toEqual(steps);
    expect(moveStep(steps, 2, 1)).toEqual(steps);
    const untimed = moveStep([{ type: 'note', say: 'a' }, { type: 'note', say: 'b', t: 5 }], 0, 1);
    expect(untimed).toEqual([{ type: 'note', say: 'b' }, { type: 'note', say: 'a', t: 5 }]);
  });

  it('removes a step', () => {
    expect(removeStep(steps, 1).map((s) => s.t)).toEqual([100, 1500]);
  });

  it('labels steps for people', () => {
    expect(steps.map(stepLabel)).toEqual(['Click "New invoice"', 'Type in "Customer"', 'Click "#save"']);
    expect(stepLabel({ type: 'key', keys: 'Mod+K' })).toBe('Press Mod+K');
    expect(stepLabel({ type: 'wait', until: { text: 'Saved' } })).toBe('Wait for "Saved"');
    expect(stepLabel({ type: 'wait', until: { gone: true }, target: { text: 'Loading' } })).toBe('Wait until "Loading" is gone');
    expect(stepLabel({ type: 'wait', until: { gone: true } })).toBe('Wait until it is gone');
    expect(stepLabel({ type: 'wait', timeout: 100, target: { sel: '#x' } })).toBe('Wait "#x"');
    expect(stepLabel({ type: 'note', say: 'x' })).toBe('Note');
    expect(stepLabel({ type: 'dblclick', target: { xy: { x: 3, y: 4 } } })).toBe('Double-click "3, 4"');
    expect(stepLabel({ type: 'scroll', to: { y: 3 } })).toBe('Scroll');
    expect(stepLabel({ type: 'hover', target: { text: 'A very long piece of text that goes on and on and on' } })).toBe('Point at "A very long piece of text that goes on …"');
  });

  it('makes guide ids from titles', () => {
    expect(guideId('Create an invoice')).toBe('create-an-invoice');
    expect(guideId('  Créer une facture!  ')).toBe('creer-une-facture');
    expect(guideId('???')).toBe('guide');
    expect(guideId('a'.repeat(70)).length).toBe(64);
    expect(guideId(`${'a'.repeat(63)} b`)).toBe('a'.repeat(63));
  });

  it('builds a valid manifest entry', () => {
    const e = entryOf({ id: 'create-invoice', title: ' Create an invoice ', modes: ['overlay', 'perform'], pages: ['/a'] });
    expect(e).toEqual({ id: 'create-invoice', title: 'Create an invoice', trace: 'create-invoice.trace.json', modes: ['overlay', 'perform'], pages: ['/a'] });
    expect(entryOf({ id: 'x', title: 'X', modes: [], pages: [] })).toEqual({ id: 'x', title: 'X', trace: 'x.trace.json', modes: ['overlay'] });
    expect(validateManifest({ version: 1, guides: [e] }).ok).toBe(true);
  });
});
