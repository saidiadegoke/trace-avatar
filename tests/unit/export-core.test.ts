import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cropBox, fileName, liveCut, outSize, pickVideoType } from '../../src/core/export';

/** Feed frames every `step` ms with waits [s, e); return the kept frame times. */
function run(max: number, waits: Array<[number, number]>, until: number, step = 40) {
  const cut = liveCut<number>(max);
  const kept: number[] = [];
  let w = 0;
  let waiting = false;
  for (let t = 0; t < until; t += step) {
    while (w < waits.length && !waiting && t >= waits[w][0]) { kept.push(...cut.phase(true, waits[w][0])); waiting = true; }
    if (waiting && t >= waits[w][1]) { kept.push(...cut.phase(false, waits[w][1])); waiting = false; w += 1; continue; }
    kept.push(...cut.frame(t, t));
  }
  kept.push(...cut.end());
  return kept;
}
/** The rule: a frame at t in a wait [s, e) is dropped when s + max/2 <= t < e - max/2. */
const reference = (max: number, waits: Array<[number, number]>, until: number, step = 40) => {
  const out: number[] = [];
  for (let t = 0; t < until; t += step) {
    const inWait = waits.find(([s, e]) => t >= s && t < e);
    if (inWait && max > 0 && t >= inWait[0] + max / 2 && t < inWait[1] - max / 2) continue;
    // A frame exactly at a wait's end is the state change itself (the harness skips it).
    if (waits.some(([, e]) => t === e)) continue;
    out.push(t);
  }
  return out;
};

describe('liveCut', () => {
  it('keeps the first and last half of a long wait, in order, and short waits whole', () => {
    expect(run(800, [[1000, 4000]], 5000)).toEqual(reference(800, [[1000, 4000]], 5000));
    const kept = run(800, [[1000, 4000]], 5000);
    expect(kept.filter((t) => t >= 1000 && t < 4000)).toHaveLength(20); // 400 ms at each end at 40 ms
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    expect(run(800, [[1000, 1600]], 3000)).toEqual(reference(800, [[1000, 1600]], 3000));
    expect(run(0, [[1000, 4000]], 5000)).toHaveLength(reference(0, [[1000, 4000]], 5000).length);
  });

  it('matches the rule for any waits (property)', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 1, max: 150 })), { maxLength: 5 }),
      fc.constantFrom(0, 400, 800, 1200),
      (gaps, max) => {
        const waits: Array<[number, number]> = [];
        let at = 0;
        for (const [g, len] of gaps) { const s = at + g * 40 + 40; waits.push([s, s + len * 40]); at = s + len * 40; }
        const until = at + 2000;
        expect(run(max, waits, until)).toEqual(reference(max, waits, until));
      },
    ));
  });

  it('says when a recorder should pause: deep in a wait only', () => {
    const cut = liveCut<number>(800);
    expect(cut.paused(0)).toBe(false);
    cut.phase(true, 1000);
    expect(cut.paused(1399)).toBe(false);
    expect(cut.paused(1400)).toBe(true);
    cut.phase(false, 3000);
    expect(cut.paused(3001)).toBe(false);
    const keep = liveCut<number>(0);
    keep.phase(true, 0);
    expect(keep.paused(10_000)).toBe(false);
  });
});

describe('crop, size, names', () => {
  it('maps an element to the shared tab frame (scaled), clipped to it', () => {
    expect(cropBox({ x: 100, y: 50, w: 400, h: 300 }, { w: 1000, h: 800 }, { w: 2000, h: 1600 })).toEqual({ x: 200, y: 100, w: 800, h: 600 });
    expect(cropBox({ x: -20, y: 700, w: 400, h: 300 }, { w: 1000, h: 800 }, { w: 1000, h: 800 })).toEqual({ x: 0, y: 700, w: 380, h: 100 });
  });

  it('output size: at most the width, never upscaled, even', () => {
    expect(outSize(1601, 1001, 800)).toEqual({ w: 800, h: 500 });
    expect(outSize(641, 401)).toEqual({ w: 640, h: 400 });
    expect(outSize(300, 200, 800)).toEqual({ w: 300, h: 200 });
  });

  it('file names from the title; the first recordable type', () => {
    expect(fileName('Send an invoice!', 'gif')).toBe('send-an-invoice.gif');
    expect(fileName('Crème brûlée — été', 'webm')).toBe('creme-brulee-ete.webm');
    expect(fileName('', 'mp4')).toBe('guide.mp4');
    expect(fileName(undefined, 'gif')).toBe('guide.gif');
    expect(pickVideoType((t) => t === 'video/webm;codecs=vp8' || t === 'video/mp4')).toBe('video/webm;codecs=vp8');
    expect(pickVideoType((t) => t.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1');
    expect(pickVideoType(() => false)).toBeNull();
  });
});
