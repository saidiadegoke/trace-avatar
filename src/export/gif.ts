/**
 * The GIF chunk, loaded only when a GIF is saved: starts the encoder in a Blob worker.
 * (A page whose CSP has no `worker-src blob:` can't run it; the error says so.)
 */

import SOURCE from './gif-source.generated';
import type { FromWorker, GifStart, ToWorker } from './gif-encoder';

export interface GifJob {
  /** A frame's RGBA pixels; the buffer is handed over to the worker (don't use it afterwards). */
  add(rgba: ArrayBuffer): void;
  end(): Promise<{ blob: Blob; frames: number; durationMs: number }>;
  cancel(): void;
}

export function startGif(start: GifStart): GifJob {
  let url = '';
  let w: Worker;
  try {
    url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
    w = new Worker(url);
  } catch (e) {
    if (url) URL.revokeObjectURL(url);
    throw new Error(`the GIF encoder could not start (a Content-Security-Policy needs worker-src blob:): ${(e as Error).message}`);
  }
  let failed: string | null = null;
  let settle: ((m: FromWorker) => void) | null = null;
  w.onmessage = (e: MessageEvent<FromWorker>) => { if (e.data.type === 'error') failed = e.data.message; settle?.(e.data); };
  w.onerror = (e) => { failed = e.message || 'the GIF encoder failed'; settle?.({ type: 'error', message: failed }); };
  const send = (m: ToWorker, t: Transferable[] = []) => w.postMessage(m, t);
  const close = () => { w.terminate(); URL.revokeObjectURL(url); };
  send({ type: 'start', start });
  return {
    add(rgba) { if (!failed) send({ type: 'frame', data: rgba }, [rgba]); },
    end() {
      return new Promise((resolve, reject) => {
        if (failed) { close(); reject(new Error(failed)); return; }
        settle = (m) => {
          close();
          if (m.type === 'done') resolve({ blob: new Blob([m.bytes], { type: 'image/gif' }), frames: m.frames, durationMs: m.durationMs });
          else reject(new Error(m.message));
        };
        send({ type: 'end' });
      });
    },
    cancel: close,
  };
}
