import { describe, expect, it } from 'vitest';
import omggif from 'omggif';
import { gifStream, handler, paletteFrom } from '../../src/export/gif-encoder';
import type { FromWorker } from '../../src/export/gif-encoder';

const W = 40;
const H = 20;
/** White with a dot at x. */
const frame = (x: number, rgb = [255, 0, 170]) => {
  const f = new Uint8Array(W * H * 4).fill(255);
  for (let y = 5; y < 10; y += 1) for (let dx = 0; dx < 5; dx += 1) f.set([...rgb, 255], (y * W + x + dx) * 4);
  return f;
};
const decode = (bytes: Uint8Array) => {
  const g = new omggif.GifReader(bytes);
  const canvas = new Uint8Array(g.width * g.height * 4);
  const frames: Array<{ rgba: Uint8Array; ms: number }> = [];
  for (let i = 0; i < g.numFrames(); i += 1) { g.decodeAndBlitFrameRGBA(i, canvas); frames.push({ rgba: canvas.slice(), ms: g.frameInfo(i).delay * 10 }); }
  return { g, frames };
};

describe('gifStream', () => {
  it('writes frames as they come: size, total time, identical frames merged, changes only', () => {
    const s = gifStream({ width: W, height: H, fps: 10 });
    for (let k = 0; k < 30; k += 1) s.add(frame(k)); // x 0..29
    for (let k = 0; k < 10; k += 1) s.add(frame(30)); // a still stretch
    const d = s.end();
    expect(d.durationMs).toBe(4000);
    const { g, frames } = decode(d.bytes);
    expect([g.width, g.height]).toEqual([W, H]);
    expect(frames.reduce((a, f) => a + f.ms, 0)).toBe(4000);
    expect(g.numFrames()).toBe(31); // 0..30 moving, the still end merged into the last
    expect(frames[frames.length - 1].ms).toBe(1000); // the 10 still frames, merged
    // The dot is where it should be in the last frame (exact: its colour is in the palette).
    const last = frames[frames.length - 1].rgba;
    const at = (x: number, y: number) => Array.from(last.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
    expect(at(32, 7)).toEqual([255, 0, 170]);
    expect(at(10, 7)).toEqual([255, 255, 255]);
    // Later frames are mostly transparent (only changes written).
    expect(g.frameInfo(5).transparent_index).toBe(255);
  });

  it('the palette comes from the first second plus fixed colours: a colour that appears later but was given stays exact', () => {
    const later = [10, 200, 90];
    const s = gifStream({ width: W, height: H, fps: 10, extras: [later] });
    for (let k = 0; k < 10; k += 1) s.add(frame(0));
    s.add(frame(20, later));
    const { frames } = decode(s.end().bytes);
    const last = frames[frames.length - 1].rgba;
    expect(Array.from(last.subarray((7 * W + 22) * 4, (7 * W + 22) * 4 + 3))).toEqual(later);
    expect(paletteFrom([frame(0)], [later]).length).toBeLessThanOrEqual(255);
  });

  it('a short recording (under a second) still makes its palette; no frames is an error; a wrong size throws', () => {
    const s = gifStream({ width: W, height: H, fps: 12 });
    s.add(frame(3));
    expect(s.end().frames).toBe(1);
    expect(() => gifStream({ width: W, height: H, fps: 12 }).end()).toThrow('no frames');
    expect(() => gifStream({ width: W, height: H, fps: 12 }).add(new Uint8Array(4))).toThrow('40×20');
  });
});

describe('the worker messages', () => {
  it('start, frames (as buffers), end → done with the bytes; mistakes → error', () => {
    const out: FromWorker[] = [];
    const h = handler((m) => out.push(m));
    h({ type: 'start', start: { width: W, height: H, fps: 5 } });
    for (let k = 0; k < 6; k += 1) h({ type: 'frame', data: frame(k * 5).buffer as ArrayBuffer });
    h({ type: 'end' });
    expect(out).toHaveLength(1);
    const done = out[0];
    expect(done.type).toBe('done');
    if (done.type !== 'done') return;
    expect(done.durationMs).toBe(1200);
    expect(decode(new Uint8Array(done.bytes)).g.width).toBe(W);
    h({ type: 'start', start: { width: W, height: H, fps: 5 } });
    h({ type: 'frame', data: new ArrayBuffer(8) });
    expect(out[1]).toEqual({ type: 'error', message: 'a frame must be 40×20' });
  });
});
