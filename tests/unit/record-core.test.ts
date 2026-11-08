import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GAPS, MERGE, build, coalesce, gapMap, pruneScrolls } from '../../src/core/build';
import type { Draft } from '../../src/core/build';
import { parse } from '../../src/core/format';
import { isSecret, maskText, shouldMask } from '../../src/core/mask';
import type { FieldFacts } from '../../src/core/mask';
import { next, recClock, recElapsed, recPause, recResume } from '../../src/core/recorder-state';
import { ring } from '../../src/core/ring';

describe('ring buffer', () => {
  it('keeps samples in order and reports its size', () => {
    const r = ring(4);
    r.push(0, 1, 2); r.push(10, 3, 4);
    expect(Array.from(r.toArray())).toEqual([0, 1, 2, 10, 3, 4]);
    expect([r.size, r.dropped, r.capacity]).toEqual([2, 0, 4]);
  });
  it('drops the oldest when full, and counts them', () => {
    const r = ring(3);
    for (let i = 0; i < 5; i += 1) r.push(i, i, i);
    expect(Array.from(r.toArray())).toEqual([2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect(r.dropped).toBe(2);
  });
  it('clears, and rejects a bad capacity', () => {
    const r = ring(2.7);
    expect(r.capacity).toBe(2);
    r.push(1, 1, 1);
    r.clear();
    expect([r.size, r.dropped, r.toArray().length]).toEqual([0, 0, 0]);
    expect(() => ring(0)).toThrow(RangeError);
  });
  it('matches a plain array model under any pushes', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 60 }), (cap, ts) => {
      const r = ring(cap);
      ts.forEach((t) => r.push(t, t + 1, t + 2));
      const want = ts.slice(-cap).flatMap((t) => [t, t + 1, t + 2]);
      return JSON.stringify(Array.from(r.toArray())) === JSON.stringify(want) && r.dropped === Math.max(0, ts.length - cap);
    }));
  });
});

describe('mask rule', () => {
  const f = (o: Partial<FieldFacts>): FieldFacts => ({ tag: 'input', type: 'text', autocomplete: '', name: '', id: '', marked: false, revealed: false, ...o });

  it('always masks secrets, even when revealed', () => {
    for (const facts of [
      f({ type: 'password' }), f({ type: 'PASSWORD' }), f({ autocomplete: 'cc-number' }), f({ autocomplete: 'one-time-code' }),
      f({ autocomplete: 'new-password' }), f({ name: 'card_number' }), f({ id: 'cvv' }), f({ name: 'user-pin' }), f({ id: 'otp-code' }), f({ name: 'api_token' }),
    ]) {
      expect(isSecret(facts)).toBe(true);
      expect(shouldMask({ ...facts, revealed: true }, false)).toBe(true);
    }
  });
  it('masks marked fields, reveals marked-reveal fields, else follows the default', () => {
    expect(shouldMask(f({ marked: true, revealed: true }), false)).toBe(true);
    expect(shouldMask(f({ revealed: true }))).toBe(false);
    expect(shouldMask(f({}))).toBe(true);
    expect(shouldMask(f({}), false)).toBe(false);
    expect(isSecret(f({ name: 'spinner', id: 'company' }))).toBe(false);
  });
  it('stores only the length', () => {
    expect(maskText('Ada')).toBe('•••');
    expect(maskText('👋🏽x')).toHaveLength(3);
    expect(maskText('')).toBe('');
  });
});

describe('recorder state', () => {
  it('follows idle → recording ⇄ paused → stopped → recording', () => {
    expect(next('idle', 'start')).toBe('recording');
    expect(next('recording', 'pause')).toBe('paused');
    expect(next('paused', 'resume')).toBe('recording');
    expect(next('recording', 'stop')).toBe('stopped');
    expect(next('paused', 'stop')).toBe('stopped');
    expect(next('stopped', 'start')).toBe('recording');
  });
  it('ignores actions that do not apply', () => {
    expect(next('idle', 'stop')).toBe('idle');
    expect(next('idle', 'pause')).toBe('idle');
    expect(next('recording', 'start')).toBe('recording');
    expect(next('recording', 'resume')).toBe('recording');
    expect(next('stopped', 'pause')).toBe('stopped');
  });
  it('recording time leaves out pauses', () => {
    let c = recClock(1000);
    expect(recElapsed(c, 1500)).toBe(500);
    c = recPause(c, 1500);
    expect(recPause(c, 1600)).toBe(c);
    expect(recElapsed(c, 9000)).toBe(500);
    c = recResume(c, 3000);
    expect(recResume(c, 3100)).toBe(c);
    expect(recElapsed(c, 3200)).toBe(700);
    expect(recElapsed(recClock(10), 5)).toBe(0);
  });
});

describe('coalesce', () => {
  const tgt = { sel: '#a' };
  it('turns click, click, dblclick into one dblclick at the first click', () => {
    const out = coalesce([
      { kind: 'click', t: 100, key: 'a', target: tgt },
      { kind: 'click', t: 200, key: 'a', target: tgt },
      { kind: 'dblclick', t: 210, key: 'a', target: tgt },
    ]);
    expect(out).toEqual([{ kind: 'dblclick', t: 100, key: 'a', target: tgt }]);
  });
  it('keeps clicks on another element or too long before', () => {
    const out = coalesce([
      { kind: 'click', t: 0, key: 'b' },
      { kind: 'click', t: 100, key: 'a' },
      { kind: 'dblclick', t: 100 + MERGE.dblclickMs + 1, key: 'a' },
    ]);
    expect(out.map((d) => d.kind)).toEqual(['click', 'click', 'dblclick']);
  });
  it('merges keystrokes into one field into the final text, keeping the first time', () => {
    const out = coalesce([
      { kind: 'type', t: 0, key: 'f', text: 'A' },
      { kind: 'type', t: 100, key: 'f', text: 'Ad' },
      { kind: 'type', t: 1500, key: 'f', text: 'Ada', mask: true },
    ]);
    expect(out).toEqual([{ kind: 'type', t: 0, key: 'f', text: 'Ada', mask: true }]);
  });
  it('splits typing after a long gap or into another field', () => {
    const out = coalesce([
      { kind: 'type', t: 0, key: 'f', text: 'A' },
      { kind: 'type', t: MERGE.typeGapMs + 1, key: 'f', text: 'AB' },
      { kind: 'type', t: MERGE.typeGapMs + 2, key: 'g', text: 'x' },
    ]);
    expect(out.map((d) => d.text)).toEqual(['A', 'AB', 'x']);
  });
  it('merges a scroll gesture into one step to where it ended', () => {
    const out = coalesce([
      { kind: 'scroll', t: 0, key: 'window', to: { y: 10 } },
      { kind: 'scroll', t: 50, key: 'window', to: { y: 90 } },
      { kind: 'scroll', t: 500, key: 'window', to: { y: 200 } },
    ]);
    expect(out.map((d) => d.to)).toEqual([{ y: 90 }, { y: 200 }]);
  });
  it('sorts by time and never changes its input', () => {
    const input: Draft[] = [{ kind: 'key', t: 50, keys: 'Enter' }, { kind: 'click', t: 10, key: 'a' }];
    const copy = JSON.parse(JSON.stringify(input));
    expect(coalesce(input).map((d) => d.kind)).toEqual(['click', 'key']);
    expect(input).toEqual(copy);
  });
});

describe('build', () => {
  const meta = { title: 'T', viewport: { w: 1280, h: 800 } };
  const tgt = { sel: '#a' };

  it('builds a valid trace with every kind of step', () => {
    const tr = build({
      meta,
      avatar: { name: 'Ada' },
      drafts: [
        { kind: 'click', t: 100.4, key: 'a', target: tgt },
        { kind: 'type', t: 900, key: 'f', target: { sel: '#f' }, text: '•••', mask: true },
        { kind: 'type', t: 3000, key: 'g', target: { sel: '#g' }, text: 'hi' },
        { kind: 'key', t: 3500, keys: 'Mod+Enter' },
        { kind: 'scroll', t: 4000, key: 'window', to: { y: 300 } },
        { kind: 'scroll', t: 5000, key: 'p', target: { sel: '#p' }, to: { y: 20 } },
        { kind: 'dblclick', t: 6000, key: 'a', target: tgt },
      ],
      path: [0, 10, 10, 100, 20, 20, 200, 30, 30, 300, 100, 30],
      scrolls: 'all',
      maxGapMs: 0,
    })!;
    expect(parse(tr).ok).toBe(true);
    expect(tr.steps).toEqual([
      { type: 'click', t: 100, target: tgt },
      { type: 'type', t: 900, target: { sel: '#f' }, text: '•••', mask: true },
      { type: 'type', t: 3000, target: { sel: '#g' }, text: 'hi' },
      { type: 'key', t: 3500, keys: 'Mod+Enter' },
      { type: 'scroll', t: 4000, to: { y: 300 } },
      { type: 'scroll', t: 5000, to: { y: 20 }, target: { sel: '#p' } },
      { type: 'dblclick', t: 6000, target: tgt },
    ]);
    expect(tr.avatar).toEqual({ name: 'Ada' });
    expect(tr.meta).toEqual(meta);
    expect(tr.path).toEqual([[0, 10, 10], [200, 30, 30], [300, 100, 30]]);
  });

  it('drops drafts without what they need, and returns null when nothing is left', () => {
    expect(build({ meta, drafts: [] })).toBeNull();
    expect(build({ meta, drafts: [{ kind: 'click', t: 0 }, { kind: 'key', t: 1 }] })).toBeNull();
  });

  it('leaves out the path when asked, or when it is too short', () => {
    const drafts: Draft[] = [{ kind: 'click', t: 0, key: 'a', target: tgt }];
    expect(build({ meta, drafts, path: [0, 1, 1, 10, 2, 2], keepPath: false })!.path).toBeUndefined();
    expect(build({ meta, drafts, path: [0, 1, 1] })!.path).toBeUndefined();
    expect(build({ meta, drafts })!.avatar).toBeUndefined();
  });
});

describe('pruneScrolls', () => {
  const sc = (t: number, key = 'window', y = t): Draft => ({ kind: 'scroll', t, key, to: { y } });
  const click = (t: number): Draft => ({ kind: 'click', t, key: 'a', target: { sel: '#a' } });

  it('drops a run of scrolls before an action on an element (the player scrolls there itself)', () => {
    expect(pruneScrolls([sc(1), sc(2), click(3)]).map((d) => d.kind)).toEqual(['click']);
    expect(pruneScrolls([sc(1), { kind: 'type', t: 2, key: 'f', target: { sel: '#f' }, text: 'x' }]).map((d) => d.kind)).toEqual(['type']);
    expect(pruneScrolls([sc(1), { kind: 'key', t: 2, keys: 'Enter', target: { sel: '#f' } }]).map((d) => d.kind)).toEqual(['key']);
  });
  it('keeps where each scroller ended when nothing on an element follows', () => {
    const out = pruneScrolls([click(0), sc(1, 'window', 10), sc(2, 'p', 5), sc(3, 'window', 30), { kind: 'key', t: 4, keys: 'Escape' }, sc(5, 'window', 50)]);
    expect(out.map((d) => [d.kind, d.key, d.to?.y])).toEqual([
      ['click', 'a', undefined], ['scroll', 'p', 5], ['scroll', 'window', 30], ['key', undefined, undefined], ['scroll', 'window', 50],
    ]);
  });
  it("'all' keeps every scroll; neither mode changes its input", () => {
    const input = [sc(1), sc(2), click(3)];
    const copy = JSON.parse(JSON.stringify(input));
    expect(pruneScrolls(input, 'all')).toEqual(input);
    expect(pruneScrolls(input, 'all')).not.toBe(input);
    pruneScrolls(input);
    expect(input).toEqual(copy);
  });
});

describe('gapMap', () => {
  it('shortens only the stretches longer than the limit, and keeps the rest as recorded', () => {
    const m = gapMap([1000, 2000, 30000, 31000], 4000, 1500);
    expect([0, 1000, 2000, 30000, 31000].map(m)).toEqual([0, 1000, 2000, 3500, 4500]);
    expect(m(16000)).toBe(2750); // halfway through the squeezed stretch
    expect(m(31200)).toBe(4700);
    expect(m(99999)).toBe(4500 + 1500); // past the last anchor: at most one idle stretch
  });
  it('squeezes a long start too, and never reorders anything', () => {
    const m = gapMap([9000, 9500], 4000, 1500);
    expect([m(9000), m(9500)]).toEqual([1500, 2000]);
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 100000 }), { minLength: 1, maxLength: 20 }), fc.array(fc.integer({ min: 0, max: 120000 }), { minLength: 2, maxLength: 30 }), (anchors, ts) => {
      const f = gapMap(anchors);
      const sorted = [...ts].sort((a, b) => a - b).map(f);
      return sorted.every((v, i) => i === 0 || v >= sorted[i - 1]);
    }));
  });
  it('0 or Infinity keeps real time', () => {
    expect(gapMap([50000], 0)(50000)).toBe(50000);
    expect(gapMap([50000], Infinity)(50000)).toBe(50000);
  });
});

describe('build defaults', () => {
  it('drops scrolls the player does anyway and shortens long pauses, path included', () => {
    const tr = build({
      meta: {},
      drafts: [
        { kind: 'scroll', t: 500, key: 'window', to: { y: 100 } },
        { kind: 'click', t: 9000, key: 'a', target: { sel: '#a' } },
        { kind: 'click', t: 40000, key: 'b', target: { sel: '#b' } },
      ],
      path: [0, 1, 1, 8000, 5, 5, 9000, 10, 10, 39000, 20, 20],
    })!;
    expect(tr.steps.map((s) => [s.type, s.t])).toEqual([['click', GAPS.idleMs], ['click', 2 * GAPS.idleMs]]);
    const times = (tr.path as number[][]).map((p) => p[0]);
    expect(times[0]).toBe(0);
    expect(times).toContain(GAPS.idleMs);
    expect(times.every((t, i) => i === 0 || t >= times[i - 1])).toBe(true);
    expect(Math.max(...times)).toBeLessThanOrEqual(2 * GAPS.idleMs);
  });
});

describe('build: pages', () => {
  it('a step names its page only when it changes', () => {
    const tr = build({ meta: {}, maxGapMs: 0, drafts: [
      { kind: 'click', t: 0, key: 'a', target: { sel: '#a' }, page: '/app' },
      { kind: 'key', t: 10, keys: 'Enter', page: '/app' },
      { kind: 'click', t: 20, key: 'b', target: { sel: '#b' }, page: '/app/tasks/new' },
      { kind: 'click', t: 30, key: 'c', target: { sel: '#c' } },
      { kind: 'click', t: 40, key: 'd', target: { sel: '#d' }, page: '/app' },
    ] })!;
    expect(tr.steps.map((s) => s.page)).toEqual(['/app', undefined, '/app/tasks/new', undefined, '/app']);
    const r = parse(tr);
    expect(r.ok && r.trace.steps.map((s) => s.page)).toEqual(['/app', '/app', '/app/tasks/new', '/app/tasks/new', '/app']);
  });
});
