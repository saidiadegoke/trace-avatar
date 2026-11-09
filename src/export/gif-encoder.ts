/**
 * A GIF written as frames arrive (it runs in a worker during "Save as video").
 *
 * Frames are held only until the palette is made: from the first second's frames plus fixed colours
 * (the avatar's, a grey ramp), then fixed. Identical frames in a row merge; each later frame holds only
 * the pixels that changed (the rest are transparent and the frame below shows through).
 */

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { Palette } from 'gifenc';

export interface GifStart {
  width: number;
  height: number;
  fps: number;
  /** Colours always in the palette (the avatar's), as [r, g, b]. */
  extras?: number[][];
  /** Frames held to make the palette. Default: one second's worth. */
  paletteFrames?: number;
}

export interface GifDone { bytes: Uint8Array; frames: number; durationMs: number }

/** The index for "unchanged"; 255 real colours sit before it. */
const CLEAR = 255;
const GREYS = [0, 36, 73, 109, 146, 182, 219, 255].map((v) => [v, v, v]);

/** One palette from frames (every 3rd pixel) plus the fixed colours. Exported for tests. */
export function paletteFrom(frames: readonly Uint8Array[], extras: number[][] = []): Palette {
  const fixed = [...extras.map((c) => c.slice(0, 3)), ...GREYS];
  const n = frames.reduce((a, f) => a + Math.ceil(f.length / 12), 0);
  const all = new Uint8Array(Math.max(1, n) * 4);
  let o = 0;
  for (const f of frames) {
    for (let p = 0; p < f.length; p += 12) { all[o] = f[p]; all[o + 1] = f[p + 1]; all[o + 2] = f[p + 2]; all[o + 3] = 255; o += 4; }
  }
  const learned = o ? quantize(all.subarray(0, o), CLEAR - fixed.length) : [];
  return [...learned, ...fixed];
}

export interface GifStream { add(rgba: Uint8Array): void; end(): GifDone }

export function gifStream(o: GifStart): GifStream {
  const { width, height } = o;
  const step = 1000 / o.fps;
  const hold = o.paletteFrames ?? Math.max(1, Math.round(o.fps));
  const gif = GIFEncoder();
  const early: Uint8Array[] = [];
  let palette: Palette | null = null;
  let prev: Uint8Array | null = null;
  let pending: { index: Uint8Array; ms: number } | null = null;
  let shown = 0;
  let count = 0;

  const flush = () => {
    if (!pending) return;
    const { index, ms } = pending;
    // GIF delays are hundredths: carry the rounding so the total stays right.
    const delay = Math.max(20, Math.round((shown + ms) / 10) * 10 - Math.round(shown / 10) * 10);
    shown += ms;
    if (!prev) {
      const full = [...palette!, ...Array.from({ length: CLEAR + 1 - palette!.length }, () => [0, 0, 0])];
      gif.writeFrame(index, width, height, { palette: full, delay, repeat: 0 });
    } else {
      const diff = new Uint8Array(index.length);
      for (let i = 0; i < index.length; i += 1) diff[i] = index[i] === prev[i] ? CLEAR : index[i];
      gif.writeFrame(diff, width, height, { delay, transparent: true, transparentIndex: CLEAR, dispose: 1 });
    }
    prev = index;
    count += 1;
    pending = null;
  };
  const put = (rgba: Uint8Array) => {
    const index = applyPalette(rgba, palette!);
    if (pending && same(pending.index, index)) { pending.ms += step; return; }
    flush();
    pending = { index, ms: step };
  };
  const ready = () => {
    palette = paletteFrom(early, o.extras);
    for (const f of early.splice(0)) put(f);
  };

  return {
    add(rgba) {
      if (rgba.length !== width * height * 4) throw new Error(`a frame must be ${width}×${height}`);
      if (palette) { put(rgba); return; }
      early.push(rgba);
      if (early.length >= hold) ready();
    },
    end() {
      if (!palette) ready();
      flush();
      if (!count) throw new Error('no frames were recorded');
      gif.finish();
      return { bytes: gif.bytes(), frames: count, durationMs: Math.round(shown) };
    },
  };
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** The worker's side of the messages: start, frame (an ArrayBuffer), end → done (or error). */
export type ToWorker = { type: 'start'; start: GifStart } | { type: 'frame'; data: ArrayBuffer } | { type: 'end' };
export type FromWorker = { type: 'done'; bytes: ArrayBuffer; frames: number; durationMs: number } | { type: 'error'; message: string };

export function handler(post: (m: FromWorker, transfer?: Transferable[]) => void): (m: ToWorker) => void {
  let s: GifStream | null = null;
  return (m) => {
    try {
      if (m.type === 'start') s = gifStream(m.start);
      else if (m.type === 'frame') s!.add(new Uint8Array(m.data));
      else {
        const d = s!.end();
        const bytes = d.bytes.slice().buffer;
        post({ type: 'done', bytes, frames: d.frames, durationMs: d.durationMs }, [bytes]);
        s = null;
      }
    } catch (e) { post({ type: 'error', message: (e as Error).message }); }
  };
}
