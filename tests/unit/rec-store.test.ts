import { describe, expect, it } from 'vitest';
import { REC_PATH_MS, REC_PERSIST_MS, cameFromElsewhere, clockAt, resumeElapsed, savedOk, trimPath } from '../../src/core/rec-store';
import type { SavedRecording } from '../../src/core/rec-store';
import { recElapsed } from '../../src/core/recorder-state';
import { build } from '../../src/core/build';

const saved = (o: Partial<SavedRecording> = {}): SavedRecording => ({
  v: 1, state: 'recording', elapsed: 5000, savedAt: 1_000_000, origin: 'https://app.example',
  drafts: [{ kind: 'click', t: 100, target: { sel: '#a' } }], path: [0, 1, 2], touches: 0, pointers: 1, ...o,
});

describe('trimPath', () => {
  it('keeps the last keepMs of samples, rounded', () => {
    expect(trimPath(new Float32Array([0, 1.4, 2.6, 100, 3, 4, 200, 5, 6]), 250, 100)).toEqual([200, 5, 6]);
    expect(trimPath([0, 1, 1, 10, 2, 2], 10)).toEqual([0, 1, 1, 10, 2, 2]);
    expect(trimPath([0, 1, 1, 10], 10)).toEqual([0, 1, 1]); // a broken tail is ignored
    expect(REC_PATH_MS).toBe(120_000);
  });
});

describe('savedOk', () => {
  const now = 1_000_500;
  it('accepts a fresh, well-formed recording, running or paused', () => {
    expect(savedOk(saved(), now)).toBe(true);
    expect(savedOk(saved({ state: 'paused', drafts: [{ kind: 'note', t: 1, say: 'x' }], signin: true }), now)).toBe(true);
  });
  it('rejects anything stale, from the future, or malformed', () => {
    expect(savedOk(saved({ savedAt: now - REC_PERSIST_MS }), now)).toBe(false);
    expect(savedOk(saved({ savedAt: now + 1 }), now)).toBe(false);
    expect(savedOk(saved(), now, 100)).toBe(false);
    for (const bad of [
      null, 'x', { ...saved(), v: 2 }, { ...saved(), state: 'stopped' }, { ...saved(), elapsed: -1 }, { ...saved(), origin: 1 },
      { ...saved(), drafts: 'x' }, { ...saved(), drafts: [{ kind: 'fly', t: 1 }] }, { ...saved(), drafts: [{ kind: 'click' }] }, { ...saved(), drafts: [null] },
      { ...saved(), path: [1, 2] }, { ...saved(), path: [1, 2, 'x'] }, { ...saved(), touches: '0' }, { ...saved(), pointers: undefined },
    ]) expect(savedOk(bad, now)).toBe(false);
  });
});

describe('resumeElapsed / clockAt', () => {
  it('a running recording counts the page load as time (a gap the builder squeezes); a paused one does not', () => {
    expect(resumeElapsed(saved(), 1_002_000)).toBe(7000);
    expect(resumeElapsed(saved({ state: 'paused' }), 1_002_000)).toBe(5000);
    expect(resumeElapsed(saved(), 999_000)).toBe(5000); // a clock that went backwards
  });
  it('a clock that reads the given time, running or paused', () => {
    const run = clockAt(300, 7000, false);
    expect(recElapsed(run, 300)).toBe(7000);
    expect(recElapsed(run, 400)).toBe(7100);
    const held = clockAt(300, 5000, true);
    expect(recElapsed(held, 900)).toBe(5000);
  });
});

describe('cameFromElsewhere', () => {
  it('by the referrer’s origin', () => {
    expect(cameFromElsewhere('', 'https://app.example')).toBe(false);
    expect(cameFromElsewhere('https://app.example/login', 'https://app.example')).toBe(false);
    expect(cameFromElsewhere('https://auth.example/authorize', 'https://app.example')).toBe(true);
    expect(cameFromElsewhere('not a url', 'https://app.example')).toBe(false);
  });
});

describe('note drafts', () => {
  it('become note steps (with pause); a note without a caption is dropped', () => {
    const t = build({ drafts: [{ kind: 'click', t: 0, target: { sel: '#a' } }, { kind: 'note', t: 100, say: 'Sign in, then press play.', pause: true }, { kind: 'note', t: 200 }], meta: {} });
    expect(t!.steps.map((s) => s.type)).toEqual(['click', 'note']);
    expect(t!.steps[1]).toMatchObject({ say: 'Sign in, then press play.', pause: true });
    expect(build({ drafts: [{ kind: 'note', t: 0, say: 'x' }], meta: {} })!.steps[0]).toEqual({ type: 'note', t: 0, say: 'x' });
  });
});
