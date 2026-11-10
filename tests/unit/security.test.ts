import { describe, expect, it } from 'vitest';
import { parse } from '../../src/core/format';
import { isMoney } from '../../src/core/mask';
import type { FieldFacts } from '../../src/core/mask';
import { guardsOf, handoffOf, valueFor } from '../../src/core/security';
import type { Effect } from '../../src/core/player';
import { CFG, Sim, box, trace } from './harness';

const field = (o: Partial<FieldFacts> = {}): FieldFacts => ({ tag: 'input', type: 'text', autocomplete: '', name: '', id: '', marked: false, revealed: false, ...o });

describe('the upload step and run-time values in the format', () => {
  it('an upload step needs files with names; url or text makes a sample', () => {
    expect(parse({ version: 1, steps: [{ type: 'upload', target: { sel: '#f' } }] }).ok).toBe(false);
    const bad = parse({ version: 1, steps: [{ type: 'upload', target: { sel: '#f' }, files: [{ name: '' }, { name: 'a', url: 'javascript:x' }, { name: 'b', url: 'x', text: 'y' }] }] });
    expect(bad.ok ? [] : bad.errors.map((e) => e.path)).toEqual(['steps[0].files[0].name', 'steps[0].files[1].url', 'steps[0].files[2]']);
    const ok = parse({ version: 1, steps: [{ type: 'upload', target: { sel: '#f' }, files: [{ name: 'a.csv', type: 'text/csv', size: 3, url: 'data:text/csv;base64,YSxi' }, { name: 'b.txt', text: 'hi' }] }] });
    expect(ok.ok && ok.trace.steps[0]).toMatchObject({ type: 'upload', moves: true, highlight: true, files: [{ name: 'a.csv' }, { name: 'b.txt' }] });
  });

  it('value names a run-time value, only on a type step', () => {
    const r = parse({ version: 1, steps: [{ type: 'type', target: { sel: '#p' }, text: '•', mask: true, value: 'password' }] });
    expect(r.ok && r.trace.steps[0].value).toBe('password');
    expect(parse({ version: 1, steps: [{ type: 'click', target: { sel: '#p' }, value: 'x' }] }).ok).toBe(false);
  });
});

describe('security', () => {
  const step = (raw: object) => trace({ steps: [raw as never] }).steps[0];

  it('guards: true is all, a list is those, nothing is none', () => {
    expect([...guardsOf(true)]).toEqual(['secrets', 'money', 'files']);
    expect([...guardsOf(['money', 'nope' as never])]).toEqual(['money']);
    expect(guardsOf(undefined).size).toBe(0);
    expect(guardsOf(false).size).toBe(0);
  });

  it('money fields: by autocomplete, name, id or label', () => {
    expect(isMoney(field({ autocomplete: 'transaction-amount' }))).toBe(true);
    expect(isMoney(field({ name: 'top_up_amount' }))).toBe(true);
    expect(isMoney(field({ hint: 'Price (₦)' }))).toBe(true);
    expect(isMoney(field({ name: 'email', hint: 'Your email' }))).toBe(false);
  });

  it('a value is found by the step’s value name, else its label, in any case', () => {
    expect(valueFor({ PASSWORD: 'p' }, step({ type: 'type', target: { role: 'textbox', name: 'Password' }, text: '•' }))).toBe('p');
    expect(valueFor({ pin: '1234' }, step({ type: 'type', target: { sel: '#x' }, text: '•', value: 'PIN' }))).toBe('1234');
    expect(valueFor({ other: 'x' }, step({ type: 'type', target: { sel: '#x' }, text: '•' }))).toBeUndefined();
    expect(valueFor({ password: 'p' }, step({ type: 'type', target: { sel: '#pw' }, text: '•' }), { name: 'password', id: 'pw' })).toBe('p');
    expect(valueFor({ 'Your PIN': '1' }, step({ type: 'type', target: { sel: '#x' }, text: '•' }), { name: '', id: '', hint: 'your pin' })).toBe('1');
  });

  it('what is the viewer’s: by default only what the guide can’t know; security adds its guards; a value always stands in', () => {
    const none = guardsOf(false);
    const all = guardsOf(true);
    const pw = { field: field({ type: 'password' }), frame: false };
    const amount = { field: field({ name: 'amount' }), frame: false };
    const typed = step({ type: 'type', target: { sel: '#p' }, text: 'demo' });
    const masked = step({ type: 'type', target: { sel: '#p' }, text: '••', mask: true });
    expect(handoffOf(typed, pw, none, undefined)).toBeNull();
    expect(handoffOf(typed, amount, none, undefined)).toBeNull();
    expect(handoffOf(masked, pw, none, undefined)).toBe('masked');
    expect(handoffOf(typed, pw, all, undefined)).toBe('secret');
    expect(handoffOf(typed, amount, all, undefined)).toBe('money');
    expect(handoffOf(masked, pw, all, 'given')).toBeNull();
    const sample = step({ type: 'upload', target: { sel: '#f' }, files: [{ name: 'a', text: 'a' }] });
    const nameOnly = step({ type: 'upload', target: { sel: '#f' }, files: [{ name: 'a', size: 1 }] });
    expect(handoffOf(sample, null, none, undefined)).toBeNull();
    expect(handoffOf(nameOnly, null, none, undefined)).toBe('no-file');
    expect(handoffOf(sample, null, all, undefined)).toBe('file');
    const click = step({ type: 'click', target: { sel: 'iframe' } });
    expect(handoffOf(click, { field: null, frame: true }, none, undefined)).toBe('frame');
    expect(handoffOf(click, { field: null, frame: false }, none, undefined)).toBeNull();
  });
});

describe('the player hands over what the shell says (perform mode)', () => {
  const P = { ...CFG, perform: true };
  const A = box(100, 100);
  const B = box(500, 300);
  const acts = (fx: Effect[]) => fx.filter((f) => f.fx === 'act' || f.fx === 'handoff');

  it('the shell decides: a masked field it has a value for is acted; a click it can’t reach is handed over', () => {
    const t = trace({ steps: [{ type: 'type', target: { sel: '#pw' }, text: '••', mask: true }, { type: 'click', target: { sel: '#frame' } }] });
    const sim = new Sim(t, { 0: A, 1: B }, P);
    sim.hand = (i) => i === 1;
    sim.play();
    sim.until(99_999);
    expect(acts(sim.fx)).toEqual([{ fx: 'act', i: 0, x: 150, y: 120 }, { fx: 'handoff', i: 1 }]);
    expect(sim.view.turn).toEqual({ i: 1, type: 'click', label: '#frame' });
    expect(sim.view.caption?.text).toBe('Your turn: do “#frame”, then press Done.');
  });

  it('without the shell, an upload with no sample file is the viewer’s; with one it is acted', () => {
    const t = trace({ steps: [{ type: 'upload', target: { sel: '#f' }, files: [{ name: 'a.csv' }] }, { type: 'upload', target: { sel: '#f' }, files: [{ name: 'a.csv', text: 'x' }] }] });
    const sim = new Sim(t, { 0: A, 1: A }, P).play();
    sim.until(99_999);
    expect(acts(sim.fx)).toEqual([{ fx: 'handoff', i: 0 }]);
    expect(sim.view.caption?.text).toBe('Your turn: choose a file for “#f”.');
    sim.send({ kind: 'play' });
    sim.until(99_999);
    expect(acts(sim.fx)).toEqual([{ fx: 'handoff', i: 0 }, { fx: 'act', i: 1, x: 150, y: 120 }]);
  });

  it('a handoff message (an upload that failed) makes that step the viewer’s turn, then play carries on after it', () => {
    const t = trace({ steps: [{ type: 'upload', target: { sel: '#f' }, files: [{ name: 'a', text: 'x' }] }, { type: 'click', target: { sel: '#b' } }, { type: 'click', target: { sel: '#b' } }] });
    const sim = new Sim(t, { 0: A, 1: B, 2: B }, P).play();
    sim.until(t.at[1] + 10);
    const fx = sim.send({ kind: 'handoff', i: 0 });
    expect(fx).toEqual([{ fx: 'handoff', i: 0 }]);
    expect(sim.s).toMatchObject({ phase: 'paused', why: 'handoff', i: 0 });
    expect(sim.send({ kind: 'handoff', i: 2 })).toEqual([]); // not while paused, nor for a step not reached
    sim.send({ kind: 'play' });
    expect(sim.s).toMatchObject({ phase: 'playing', i: 1 });
  });
});
