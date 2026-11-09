/**
 * "Save as video": record a guide playing on this very page, as a GIF or a video file.
 *
 *   share this tab (the browser asks) ──► <video> ──► canvas, cropped to `area`, at fps
 *     ├─ GIF:   each kept frame ──► encoder worker (gifenc), written as it goes
 *     └─ video: canvas.captureStream ──► MediaRecorder (WebM, or MP4 in Safari), paused deep in long waits
 *
 * Long waits are cut live with the renderer's rule (core/export.ts). Pause steps play on after a beat; a
 * Do it for me hand-off waits for the viewer (that wait is cut too).
 */

import { cropBox, fileName, liveCut, outSize, pickVideoType } from '../core/export';
import type { Box } from '../core/export';
import type { TraceController } from '../index';
import type { GifJob } from './gif';

export interface SaveVideoOptions {
  /** 'gif' (default) or 'video' (WebM where the browser records it, else MP4). */
  format?: 'gif' | 'video';
  /** The part of the page to keep. Default: the whole viewport. */
  area?: Element;
  /** Output width (never upscaled). Default: GIF 800, video the area's own size. */
  width?: number;
  /** Default: GIF 12, video 30. */
  fps?: number;
  /** Waits longer than this are cut to it (the first and last half). 0 keeps them. Default 800. */
  maxWaitMs?: number;
  /** A pause step is held this long, then the guide plays on. Default 1200. */
  pauseHoldMs?: number;
  /** Still frames before the guide starts, and after it ends. Defaults 500 and 1500. */
  leadMs?: number;
  holdEndMs?: number;
  /** Stop and reject with an ExportError('cancelled'). */
  signal?: AbortSignal;
  onProgress?: (p: { phase: 'asking' | 'recording' | 'encoding'; ms?: number }) => void;
}

export interface SavedVideo {
  blob: Blob;
  /** image/gif, video/webm…, video/mp4… */
  type: string;
  /** Length after cuts. */
  durationMs: number;
  /** e.g. "send-an-invoice.gif", from the trace's title. */
  filename: string;
  /** Save it (a download link, clicked). */
  download(): void;
}

export type ExportReason = 'unsupported' | 'denied' | 'cancelled' | 'stalled' | 'failed';

export class ExportError extends Error {
  constructor(public readonly reason: ExportReason, message: string) { super(message); this.name = 'ExportError'; }
}

export interface ExportLoaders { gif(): Promise<{ startGif(o: { width: number; height: number; fps: number; extras?: number[][] }): GifJob }> }

const rgbOf = (hex: string | undefined): number[] | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

export async function saveVideoWith(controller: TraceController, o: SaveVideoOptions, loaders: ExportLoaders): Promise<SavedVideo> {
  const doc = document;
  const win = window;
  const gif = (o.format ?? 'gif') === 'gif';
  const fps = o.fps ?? (gif ? 12 : 30);
  const media = navigator.mediaDevices as MediaDevices | undefined;
  if (!media?.getDisplayMedia) throw new ExportError('unsupported', 'this browser cannot record a tab (getDisplayMedia is missing)');
  const videoType = gif ? null : (typeof MediaRecorder === 'undefined' ? null : pickVideoType((t) => MediaRecorder.isTypeSupported(t)));
  if (!gif && !videoType) throw new ExportError('unsupported', 'this browser cannot record video (MediaRecorder); save a GIF instead');
  if (o.signal?.aborted) throw new ExportError('cancelled', 'cancelled');
  await controller.ready;
  // Load the encoder before asking, so a failure doesn't come after the viewer agreed to share.
  const gifLib = gif ? await loaders.gif().catch((e: Error) => { throw new ExportError('failed', `the GIF encoder could not load: ${e.message}`); }) : null;
  controller.stop();

  o.onProgress?.({ phase: 'asking' });
  let stream: MediaStream;
  try {
    stream = await media.getDisplayMedia({
      video: { frameRate: Math.max(fps, 30) }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (e) {
    const name = (e as DOMException)?.name;
    throw new ExportError(name === 'NotAllowedError' || name === 'AbortError' ? 'denied' : 'failed', `could not share the tab: ${(e as Error).message || name}`);
  }

  const cleanup: Array<() => void> = [() => stream.getTracks().forEach((t) => t.stop())];
  const video = doc.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  let job: GifJob | null = null;
  let rec: MediaRecorder | null = null;

  try {
    await video.play();
    for (let k = 0; k < 100 && !video.videoWidth; k += 1) await sleep(20);
    if (!video.videoWidth) throw new ExportError('failed', 'the shared tab sent no picture');
    await sleep(300); // the browser's "sharing this tab" bar may resize the page first

    const viewport = () => ({ w: win.innerWidth, h: win.innerHeight });
    const crop = (): Box => {
      const vid = { w: video.videoWidth, h: video.videoHeight };
      const r = o.area ? o.area.getBoundingClientRect() : { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight };
      return cropBox({ x: r.x, y: r.y, w: r.width, h: r.height }, viewport(), vid);
    };
    const first = crop();
    const size = outSize(first.w, first.h, o.width ?? (gif ? 800 : undefined));
    const canvas = doc.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: gif })!;
    const draw = () => { const c = crop(); ctx.drawImage(video, c.x, c.y, c.w, c.h, 0, 0, size.w, size.h); };
    draw();

    const chunks: Blob[] = [];
    if (gifLib) {
      const extras = [rgbOf(controller.trace?.avatar.color)].filter(Boolean) as number[][];
      job = gifLib.startGif({ width: size.w, height: size.h, fps, extras });
    } else {
      const cs = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(fps);
      cleanup.push(() => cs.getTracks().forEach((t) => t.stop()));
      rec = new MediaRecorder(cs, { mimeType: videoType! });
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    }

    const cut = liveCut<ArrayBuffer | null>(o.maxWaitMs ?? 800);
    let kept = 0;
    const emit = (fs: Array<ArrayBuffer | null>) => { for (const f of fs) { kept += 1; if (f && job) job.add(f); } };

    await new Promise<void>((resolve, reject) => {
      let done = false;
      let handoff = false;
      let ended = false;
      const fail = (e: ExportError) => { if (!done) { done = true; reject(e); } };
      const finish = () => { if (!done) { done = true; resolve(); } };
      const now = () => performance.now();
      const track = stream.getVideoTracks()[0];
      const tick = () => {
        // The viewer pressed the browser's "Stop sharing" (not every browser fires 'ended').
        if (!track || track.readyState === 'ended') { fail(new ExportError('cancelled', 'sharing stopped before the guide ended')); return; }
        const t = now();
        draw();
        if (rec) {
          const p = cut.paused(t);
          if (p && rec.state === 'recording') rec.pause();
          else if (!p && rec.state === 'paused') rec.resume();
          if (!p) kept += 1;
        } else {
          emit(cut.frame(ctx.getImageData(0, 0, size.w, size.h).data.buffer as ArrayBuffer, t));
        }
        o.onProgress?.({ phase: 'recording', ms: Math.round((kept * 1000) / fps) });
      };
      const timer = setInterval(tick, 1000 / fps);
      cleanup.push(() => clearInterval(timer));
      const offs = [
        controller.on('state', ({ phase }) => {
          if (phase === 'playing') handoff = false;
          emit(cut.phase(phase === 'waiting' || handoff, now()));
          // A pause step is a beat in a video, then it plays on; a hand-off waits for the viewer.
          if (phase === 'paused' && !handoff && !ended) setTimeout(() => { if (!done && controller.state === 'paused' && !handoff) controller.play(); }, o.pauseHoldMs ?? 1200);
        }),
        controller.on('handoff', () => { handoff = true; emit(cut.phase(true, now())); }),
        controller.on('stalled', (e) => fail(new ExportError('stalled', `step ${e.index + 1} stalled (${e.reason}): the page no longer matches the guide`))),
        controller.on('error', (e) => fail(new ExportError('failed', e.message))),
        controller.on('end', () => { ended = true; setTimeout(finish, o.holdEndMs ?? 1500); }),
      ];
      cleanup.push(() => offs.forEach((off) => off()));
      const stopped = () => fail(new ExportError('cancelled', 'sharing stopped before the guide ended'));
      track?.addEventListener('ended', stopped);
      cleanup.push(() => track?.removeEventListener('ended', stopped));
      const abort = () => fail(new ExportError('cancelled', 'cancelled'));
      o.signal?.addEventListener('abort', abort);
      cleanup.push(() => o.signal?.removeEventListener('abort', abort));
      rec?.start(250);
      setTimeout(() => { if (!done) controller.play(); }, o.leadMs ?? 500);
    });
    emit(cut.end());
    cleanup.splice(1).reverse().forEach((f) => f()); // stop the timer and listeners, keep the encoders

    o.onProgress?.({ phase: 'encoding' });
    let blob: Blob;
    let durationMs = Math.round((kept * 1000) / fps);
    if (job) {
      const g = await job.end();
      job = null;
      blob = g.blob;
      durationMs = g.durationMs;
    } else {
      const r = rec!;
      await new Promise<void>((res) => { r.onstop = () => res(); r.stop(); });
      rec = null;
      blob = new Blob(chunks, { type: videoType!.split(';')[0] });
    }
    const ext = blob.type === 'image/gif' ? 'gif' : blob.type.includes('mp4') ? 'mp4' : 'webm';
    const filename = fileName(controller.trace?.meta.title, ext);
    return {
      blob, type: blob.type, durationMs, filename,
      download() {
        const a = doc.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        doc.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      },
    };
  } catch (e) {
    job?.cancel();
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* already stopped */ }
    controller.pause();
    throw e instanceof ExportError ? e : new ExportError('failed', (e as Error).message);
  } finally {
    cleanup.reverse().forEach((f) => { try { f(); } catch { /* best effort */ } });
    video.srcObject = null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
