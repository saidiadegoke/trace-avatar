/**
 * The pure parts of "Save as video": the live cut, the crop, the file name. PURE.
 *
 * The live cut applies the renderer's rule (trace-avatar-render's editList) while recording: a wait longer
 * than maxWaitMs keeps its first and last maxWaitMs / 2; the middle is never kept. Frames come in one at a
 * time; what to emit is decided as they come, holding back at most maxWaitMs / 2 of them. A frame at t in a
 * wait [s, e) is dropped when s + maxWaitMs/2 <= t < e - maxWaitMs/2.
 */

export interface LiveCut<F> {
  /** The player's phase changed (only 'waiting' vs anything else matters). Returns frames to emit now. */
  phase(waiting: boolean, t: number): F[];
  /** A frame taken at t. Returns frames to emit now, in order. */
  frame(f: F, t: number): F[];
  /** True while a recorder should be paused (deep in a long wait). */
  paused(t: number): boolean;
  /** The end: frames still held back. */
  end(): F[];
}

export function liveCut<F>(maxWaitMs: number): LiveCut<F> {
  const half = maxWaitMs / 2;
  let since: number | null = null; // when the current wait began
  let ring: Array<{ f: F; t: number }> = []; // frames past the first half of a wait, the latest `half` ms
  const flush = (from = -Infinity): F[] => { const out = ring.filter((r) => r.t >= from).map((r) => r.f); ring = []; return out; };
  return {
    phase(waiting, t) {
      if (waiting) { if (since === null) since = t; return []; }
      since = null;
      return flush(t - half); // the wait's last half-allowance, as the renderer keeps it
    },
    frame(f, t) {
      if (since === null || maxWaitMs <= 0 || t < since + half) return [...flush(), f];
      ring.push({ f, t });
      while (ring.length && ring[0].t <= t - half) ring.shift();
      return [];
    },
    paused: (t) => since !== null && maxWaitMs > 0 && t >= since + half,
    end: () => flush(),
  };
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Where an element (CSS px, from getBoundingClientRect) is in the shared tab's video frame. The tab's
 * frame is the viewport scaled by videoWidth / innerWidth; the box is clipped to the frame.
 */
export function cropBox(rect: Box, viewport: { w: number; h: number }, video: { w: number; h: number }): Box {
  const sx = video.w / viewport.w;
  const sy = video.h / viewport.h;
  const x0 = Math.max(0, Math.round(rect.x * sx));
  const y0 = Math.max(0, Math.round(rect.y * sy));
  const x1 = Math.min(video.w, Math.round((rect.x + rect.w) * sx));
  const y1 = Math.min(video.h, Math.round((rect.y + rect.h) * sy));
  return { x: x0, y: y0, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
}

/** The output size for a crop: at most `width` wide, never upscaled, even numbers. */
export function outSize(w: number, h: number, width?: number): { w: number; h: number } {
  const W = Math.max(2, Math.floor(Math.min(width ?? w, w) / 2) * 2);
  return { w: W, h: Math.max(2, Math.round((h * W) / w / 2) * 2) };
}

/** "Send an invoice!" → "send-an-invoice.gif". */
export function fileName(title: string | undefined, ext: string): string {
  const slug = (title ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || 'guide'}.${ext}`;
}

/** The first type the browser can record, or null. */
export function pickVideoType(supported: (t: string) => boolean): string | null {
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4']) if (supported(t)) return t;
  return null;
}
