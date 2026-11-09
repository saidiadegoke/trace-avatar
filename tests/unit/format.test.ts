import { describe, expect, it } from 'vitest';
import { LIMITS, TIMING, labelOf, lastAtOrBefore, pageMatches, parse, stepAt, validate } from '../../src/core/format';
import type { Trace } from '../../src/core/format';

const ok = (raw: unknown) => {
  const r = parse(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.trace;
};
const errs = (raw: unknown) => validate(raw).errors.map((e) => e.path);
const btn = { sel: '#b' };

describe('validate', () => {
  it('accepts a minimal trace', () => {
    expect(validate({ version: 1, steps: [{ type: 'click', target: btn }] })).toEqual({ ok: true, errors: [] });
  });

  it('rejects non-objects and unknown versions', () => {
    expect(errs(null)).toEqual(['']);
    expect(errs([])).toEqual(['']);
    expect(errs({ version: 2, steps: [] })).toEqual(['version']);
    expect(validate({ version: '1', steps: [] }).errors[0].message).toMatch(/unsupported version "1"/);
  });

  it('needs a non-empty steps array within the limit', () => {
    expect(errs({ version: 1 })).toEqual(['steps']);
    expect(errs({ version: 1, steps: [] })).toEqual(['steps']);
    const many = Array.from({ length: LIMITS.steps + 1 }, () => ({ type: 'note', say: 'x' }));
    expect(errs({ version: 1, steps: many })).toEqual(['steps']);
  });

  it('checks each step type and its required fields', () => {
    expect(errs({ version: 1, steps: [{ type: 'fly' }] })).toEqual(['steps[0].type']);
    expect(errs({ version: 1, steps: [{}] })).toEqual(['steps[0].type']);
    expect(errs({ version: 1, steps: ['x'] })).toEqual(['steps[0]']);
    for (const type of ['move', 'click', 'dblclick', 'type', 'hover', 'wait']) {
      expect(errs({ version: 1, steps: [{ type, text: 'a' }] })).toContain('steps[0].target');
    }
    expect(errs({ version: 1, steps: [{ type: 'type', target: btn }] })).toEqual(['steps[0].text']);
    expect(errs({ version: 1, steps: [{ type: 'key' }] })).toEqual(['steps[0].keys']);
    expect(errs({ version: 1, steps: [{ type: 'key', keys: '' }] })).toEqual(['steps[0].keys']);
    expect(errs({ version: 1, steps: [{ type: 'note' }] })).toEqual(['steps[0].say']);
    expect(errs({ version: 1, steps: [{ type: 'scroll' }] })).toEqual(['steps[0]']);
    expect(errs({ version: 1, steps: [{ type: 'scroll', to: { y: 'a' } }] })).toEqual(['steps[0].to']);
    expect(errs({ version: 1, steps: [{ type: 'scroll', by: 3 }] })).toEqual(['steps[0].by']);
    expect(errs({ version: 1, steps: [{ type: 'scroll', by: { y: 10 } }] })).toEqual([]);
  });

  it('checks numbers, booleans and string lengths', () => {
    expect(errs({ version: 1, steps: [{ type: 'note', say: 'x', t: -1 }] })).toEqual(['steps[0].t']);
    expect(errs({ version: 1, steps: [{ type: 'note', say: 'x', t: Infinity }] })).toEqual(['steps[0].t']);
    expect(errs({ version: 1, steps: [{ type: 'note', say: 'x', hold: -5, duration: 'a', timeout: -1 }] }))
      .toEqual(['steps[0].duration', 'steps[0].hold', 'steps[0].timeout']);
    expect(errs({ version: 1, steps: [{ type: 'note', say: 'x', pause: 1, mask: 'y', highlight: null }] }))
      .toEqual(['steps[0].highlight', 'steps[0].pause', 'steps[0].mask']);
    expect(errs({ version: 1, steps: [{ type: 'note', say: 'x'.repeat(LIMITS.say + 1) }] })).toEqual(['steps[0].say']);
    expect(errs({ version: 1, steps: [{ type: 'type', target: btn, text: 'x'.repeat(LIMITS.text + 1) }] })).toEqual(['steps[0].text']);
    expect(errs({ version: 1, steps: [{ type: 'note', say: 5 }] })).toContain('steps[0].say');
  });

  it('checks targets', () => {
    const t = (target: unknown) => errs({ version: 1, steps: [{ type: 'click', target }] });
    expect(t('x')).toEqual(['steps[0].target']);
    expect(t({})).toEqual(['steps[0].target']);
    expect(t({ name: 'Save' })).toEqual(['steps[0].target', 'steps[0].target.name']);
    expect(t({ role: 'button', name: 'Save' })).toEqual([]);
    expect(t({ text: 'Save' })).toEqual([]);
    expect(t({ xy: { x: 1, y: 2 } })).toEqual([]);
    expect(t({ xy: { x: 1 } })).toEqual(['steps[0].target.xy']);
    expect(t({ sel: '#a', at: { rx: 0.5 } })).toEqual(['steps[0].target.at']);
    expect(t({ sel: 7 })).toEqual(['steps[0].target.sel']);
    expect(t({ role: 'x'.repeat(41) })).toEqual(['steps[0].target.role']);
  });

  it('checks meta and avatar', () => {
    const base = { version: 1, steps: [{ type: 'note', say: 'x' }] };
    expect(errs({ ...base, meta: 3 })).toEqual(['meta']);
    expect(errs({ ...base, meta: { viewport: { w: 0, h: 5 } } })).toEqual(['meta.viewport']);
    expect(errs({ ...base, meta: { seed: 'a', pointer: 'pen', title: 4 } })).toEqual(['meta.title', 'meta.seed', 'meta.pointer']);
    expect(errs({ ...base, avatar: [] })).toEqual(['avatar']);
    expect(errs({ ...base, avatar: { name: 'x'.repeat(81) } })).toEqual(['avatar.name']);
    for (const image of ['https://a/b.png', 'http://a/b.png', 'data:image/png;base64,AA', '/me.png', 'me.png']) {
      expect(errs({ ...base, avatar: { image } })).toEqual([]);
    }
    for (const image of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a', 3]) {
      expect(errs({ ...base, avatar: { image } })).toEqual(['avatar.image']);
    }
  });

  it('checks paths in both shapes', () => {
    const base = { version: 1, steps: [{ type: 'note', say: 'x' }] };
    expect(errs({ ...base, path: null })).toEqual([]);
    expect(errs({ ...base, path: [[0, 1, 2], [10, 3, 4]] })).toEqual([]);
    expect(errs({ ...base, path: [0, 1, 2, 10, 3, 4] })).toEqual([]);
    expect(errs({ ...base, path: 'x' })).toEqual(['path']);
    expect(errs({ ...base, path: [[0, 1]] })).toEqual(['path']);
    expect(errs({ ...base, path: [0, 1] })).toEqual(['path']);
    expect(errs({ ...base, path: [0, 1, 'a'] })).toEqual(['path']);
  });

  it('stops at 50 errors', () => {
    const steps = Array.from({ length: 80 }, () => ({ type: 'fly' }));
    expect(validate({ version: 1, steps }).errors).toHaveLength(50);
  });
});

describe('parse: timing', () => {
  it('uses t as the action time and travels up to 800ms before it', () => {
    const tr = ok({ version: 1, steps: [{ type: 'click', target: btn, t: 2000 }] });
    expect(tr.steps[0]).toMatchObject({ travelStart: 2000 - TIMING.travelMax, at: 2000, end: 2000 + TIMING.act.click, moves: true });
  });

  it('never starts travel before the previous step ends, and pushes overlapping steps later', () => {
    const tr = ok({ version: 1, steps: [
      { type: 'click', target: btn, t: 1000 },
      { type: 'click', target: btn, t: 1100 },
    ] });
    expect(tr.steps[1].travelStart).toBe(1250);
    expect(tr.steps[1].at).toBe(1250);
  });

  it('fills missing t from the previous step', () => {
    const tr = ok({ version: 1, steps: [
      { type: 'click', target: btn },
      { type: 'click', target: btn },
      { type: 'click', target: btn, duration: 300 },
    ] });
    expect(tr.steps[0]).toMatchObject({ travelStart: 0, at: 700, end: 950 });
    expect(tr.steps[1]).toMatchObject({ travelStart: 950 + TIMING.gap, at: 950 + TIMING.gap + 700 });
    expect(tr.steps[2].at - tr.steps[2].travelStart).toBe(300);
  });

  it('gives each step type its acting time', () => {
    const tr = ok({ version: 1, steps: [
      { type: 'move', target: btn, t: 0 },
      { type: 'dblclick', target: btn, t: 10_000 },
      { type: 'type', target: btn, text: 'ab', t: 20_000 },
      { type: 'type', target: btn, text: 'x'.repeat(200), t: 30_000 },
      { type: 'key', keys: 'Enter', t: 40_000 },
      { type: 'scroll', by: { y: 100 }, t: 50_000 },
      { type: 'hover', target: btn, t: 60_000 },
      { type: 'hover', target: btn, t: 70_000, hold: 2000 },
      { type: 'note', say: 'hi', t: 80_000 },
      { type: 'note', say: 'hi', t: 90_000, hold: 50 },
      { type: 'wait', target: btn, t: 100_000 },
    ] });
    const act = tr.steps.map((s) => s.end - s.at);
    expect(act).toEqual([0, 450, TIMING.typeMin, TIMING.typeMax, 600, 700, TIMING.hover, 2000, TIMING.noteMin, 50, 0]);
  });

  it('makes only steps with a target travel, never wait or note', () => {
    const tr = ok({ version: 1, steps: [
      { type: 'wait', target: btn, t: 5000 },
      { type: 'note', say: 'x', target: btn, t: 6000 },
      { type: 'key', keys: 'a', t: 7000 },
      { type: 'key', keys: 'a', target: btn, t: 8000 },
      { type: 'scroll', by: { y: 1 }, target: btn, t: 9000 },
    ] });
    expect(tr.steps.map((s) => s.moves)).toEqual([false, false, false, true, true]);
    expect(tr.steps[0].travelStart).toBe(5000);
  });

  it('sorts by t stably without changing the input', () => {
    const raw: Trace = { version: 1, steps: [
      { type: 'note', say: 'b', t: 2000 },
      { type: 'note', say: 'a', t: 1000 },
      { type: 'note', say: 'a2' },
    ] };
    const copy = JSON.parse(JSON.stringify(raw));
    const tr = ok(raw);
    expect(tr.steps.map((s) => s.say)).toEqual(['a', 'a2', 'b']);
    expect(raw).toEqual(copy);
  });

  it('builds parallel interval arrays and a duration that covers captions', () => {
    const tr = ok({ version: 1, steps: [{ type: 'click', target: btn, t: 1000, say: 'x'.repeat(100) }] });
    expect(Array.from(tr.travelStart)).toEqual([200]);
    expect(Array.from(tr.at)).toEqual([1000]);
    expect(Array.from(tr.end)).toEqual([1250]);
    expect(tr.duration).toBe(200 + 100 * TIMING.readPerChar);
  });
});

describe('parse: captions', () => {
  it('shows a caption from travel start for its reading time, cut by the next caption', () => {
    const tr = ok({ version: 1, steps: [
      { type: 'click', target: btn, t: 1000, say: 'first' },
      { type: 'click', target: btn, t: 2000 },
      { type: 'click', target: btn, t: 3000, say: 'second' },
    ] });
    expect(tr.steps[0].capFrom).toBe(200);
    expect(tr.steps[0].capTo).toBe(Math.min(200 + TIMING.readMin, tr.steps[2].travelStart));
    expect(tr.steps[2].capFrom).toBe(tr.steps[2].travelStart);
    expect(tr.steps[2].capTo).toBe(tr.steps[2].travelStart + TIMING.readMin);
  });
  it('keeps a long action on screen for the whole action', () => {
    const tr = ok({ version: 1, steps: [{ type: 'hover', target: btn, t: 0, hold: 9000, say: 'x' }] });
    expect(tr.steps[0].capTo).toBe(9000);
  });
});

describe('parse: defaults and shape', () => {
  it('applies defaults', () => {
    const tr = ok({ version: 1, steps: [
      { type: 'click', target: btn },
      { type: 'note', say: 'n' },
      { type: 'wait', target: btn },
      { type: 'type', target: btn, text: 'pw', mask: true },
      { type: 'hover', target: btn, highlight: false },
      { type: 'key', keys: 'Tab' },
      { type: 'scroll', to: { y: 10 } },
    ] });
    expect(tr.steps.map((s) => s.highlight)).toEqual([true, false, false, true, false, false, false]);
    expect(tr.steps.map((s) => s.timeout)).toEqual([4000, 4000, 5000, 4000, 4000, 4000, 4000]);
    expect(tr.steps[3]).toMatchObject({ text: 'pw', mask: true });
    expect(tr.steps[5].keys).toBe('Tab');
    expect(tr.steps[6].to).toEqual({ y: 10 });
    expect(tr.steps[0]).toMatchObject({ text: null, keys: null, to: null, by: null, say: null, pause: false });
    expect(tr.meta).toEqual({});
    expect(tr.avatar).toEqual({});
    expect(tr.seed).toBe(1);
    expect(tr.path).toBeNull();
  });

  it('reads the seed, and turns either path shape into an interleaved Float32Array', () => {
    const a = ok({ version: 1, meta: { seed: 9 }, steps: [{ type: 'note', say: 'x' }], path: [[0, 1, 2], [5, 3, 4]] });
    const b = ok({ version: 1, steps: [{ type: 'note', say: 'x' }], path: [0, 1, 2, 5, 3, 4] });
    expect(a.seed).toBe(9);
    expect(a.path).toBeInstanceOf(Float32Array);
    expect(Array.from(a.path!)).toEqual([0, 1, 2, 5, 3, 4]);
    expect(Array.from(b.path!)).toEqual([0, 1, 2, 5, 3, 4]);
    expect(ok({ version: 1, steps: [{ type: 'note', say: 'x' }], path: [] }).path).toBeNull();
  });

  it('freezes the result deeply', () => {
    const tr = ok({ version: 1, steps: [{ type: 'click', target: { sel: '#a', at: { rx: 0, ry: 0 } } }] });
    expect(Object.isFrozen(tr)).toBe(true);
    expect(Object.isFrozen(tr.steps)).toBe(true);
    expect(Object.isFrozen(tr.steps[0].target!.at)).toBe(true);
  });

  it('returns errors instead of throwing', () => {
    const r = parse({ version: 1, steps: [{ type: 'click' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ path: 'steps[0].target', message: 'a click step needs a target' });
  });
});

describe('lookups', () => {
  const tr = ok({ version: 1, steps: [
    { type: 'click', target: btn, t: 1000 }, // 200..1000..1250
    { type: 'click', target: btn, t: 2000 }, // 1250..2000..2250
    { type: 'click', target: btn, t: 3000 }, // 2250..3000..3250
  ] });

  it('stepAt finds the first step whose end is after t', () => {
    expect(stepAt(tr, 0)).toBe(0);
    expect(stepAt(tr, 1249)).toBe(0);
    expect(stepAt(tr, 1250)).toBe(1);
    expect(stepAt(tr, 2500)).toBe(2);
    expect(stepAt(tr, 99_999)).toBe(2);
  });

  it('lastAtOrBefore finds the last index at or before t', () => {
    expect(lastAtOrBefore(tr.at, 999)).toBe(-1);
    expect(lastAtOrBefore(tr.at, 1000)).toBe(0);
    expect(lastAtOrBefore(tr.at, 2999)).toBe(1);
    expect(lastAtOrBefore(tr.at, 5000)).toBe(2);
    expect(lastAtOrBefore(new Float64Array(0), 5)).toBe(-1);
  });

  it('labelOf names a target for people', () => {
    expect(labelOf(null)).toBe('the next element');
    expect(labelOf({ role: 'button', name: 'Save' })).toBe('Save');
    expect(labelOf({ text: 'New invoice', sel: '#n' })).toBe('New invoice');
    expect(labelOf({ sel: '#n' })).toBe('#n');
    expect(labelOf({ xy: { x: 1, y: 1 } })).toBe('the next element');
  });
});

describe('pages', () => {
  it('pageMatches: * is one segment; trailing slash, query, hash and encoding do not matter', () => {
    const yes: Array<[string, string]> = [
      ['/app', '/app'], ['/app', '/app/'], ['/app/tasks/*', '/app/tasks/bfd02a18-6a91'], ['/', '/'], ['/a/*/c', '/a/b/c'],
      ['/app/tasks/new', '/app/tasks/new?x=1#top'], ['/caf%C3%A9', '/café'],
    ];
    const no: Array<[string, string]> = [['/app', '/app/tasks'], ['/app/tasks/*', '/app/tasks'], ['/app/tasks/*', '/app/tasks/1/run'], ['/a', '/b'], ['/', '/app']];
    for (const [p, at] of yes) expect(pageMatches(p, at), `${p} ~ ${at}`).toBe(true);
    for (const [p, at] of no) expect(pageMatches(p, at), `${p} !~ ${at}`).toBe(false);
    expect(pageMatches('/%E0%A4%A', '/%E0%A4%A')).toBe(true); // a broken escape compares as written
  });

  it('a step page must be a path; later steps inherit it', () => {
    for (const page of ['app', '', 7, '/'.padEnd(301, 'x')]) {
      const v = validate({ version: 1, steps: [{ type: 'note', say: 'x', page }] });
      expect(v.errors.map((e) => e.path)).toEqual(['steps[0].page']);
    }
    const r = parse({ version: 1, steps: [
      { type: 'note', say: 'a' }, { type: 'note', say: 'b', page: '/app' }, { type: 'note', say: 'c' }, { type: 'note', say: 'd', page: '/app/tasks/*' },
    ] });
    expect(r.ok && r.trace.steps.map((s) => s.page)).toEqual([null, '/app', '/app', '/app/tasks/*']);
  });
});

describe('until, checkpoint, requires (0.1.2)', () => {
  const one = (step: Record<string, unknown>, meta?: Record<string, unknown>) => validate({ version: 1, ...(meta ? { meta } : {}), steps: [step] }).errors.map((e) => e.path);

  it('accepts wait until text (with or without a target) or until gone (with a target)', () => {
    expect(one({ type: 'wait', until: { text: 'Running' } })).toEqual([]);
    expect(one({ type: 'wait', target: { sel: '#s' }, until: { text: 'Running' }, timeout: 120000 })).toEqual([]);
    expect(one({ type: 'wait', target: { sel: '.spinner' }, until: { gone: true } })).toEqual([]);
  });

  it('rejects until anywhere else, or malformed', () => {
    expect(one({ type: 'click', target: { sel: '#a' }, until: { text: 'x' } })).toEqual(['steps[0].until']);
    expect(one({ type: 'wait', target: { sel: '#a' }, until: {} })).toEqual(['steps[0].until']);
    expect(one({ type: 'wait', target: { sel: '#a' }, until: { text: 'x', gone: true } })).toEqual(['steps[0].until']);
    expect(one({ type: 'wait', target: { sel: '#a' }, until: 'x' })).toEqual(['steps[0].until']);
    expect(one({ type: 'wait', target: { sel: '#a' }, until: { text: '  ' } })).toEqual(['steps[0].until.text']);
    expect(one({ type: 'wait', target: { sel: '#a' }, until: { text: 'x'.repeat(501) } })).toEqual(['steps[0].until.text']);
    expect(one({ type: 'wait', target: { sel: '#a' }, until: { gone: false } })).toEqual(['steps[0].until.gone']);
    expect(one({ type: 'wait', until: { gone: true } })).toEqual(['steps[0].target']);
    expect(one({ type: 'wait' })).toEqual(['steps[0].target']);
  });

  it('caps timeouts at 10 minutes and checks checkpoint and requires', () => {
    expect(one({ type: 'wait', until: { text: 'x' }, timeout: 600_001 })).toEqual(['steps[0].timeout']);
    expect(one({ type: 'wait', until: { text: 'x' }, timeout: 600_000 })).toEqual([]);
    expect(one({ type: 'note', say: 'x', checkpoint: 'yes' })).toEqual(['steps[0].checkpoint']);
    expect(one({ type: 'note', say: 'x' }, { requires: ['signed-in', 'sandbox'] })).toEqual([]);
    for (const requires of ['signed-in', [''], ['x'.repeat(61)], [1], Array(11).fill('a')]) expect(one({ type: 'note', say: 'x' }, { requires })).toEqual(['meta.requires']);
  });

  it('normalises until and checkpoint', () => {
    const r = parse({ version: 1, meta: { requires: ['signed-in'] }, steps: [
      { type: 'wait', until: { text: 'Running' } }, { type: 'wait', target: { sel: '#s' }, until: { gone: true } }, { type: 'note', say: 'x', checkpoint: true },
    ] });
    expect(r.ok && r.trace.steps.map((s) => [s.until, s.checkpoint])).toEqual([[{ text: 'Running' }, false], [{ gone: true }, false], [null, true]]);
    expect(r.ok && r.trace.meta.requires).toEqual(['signed-in']);
  });
});
