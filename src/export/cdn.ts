/**
 * The CDN build of the export (trace-export.min.js, global TraceAvatarExport). The GIF encoder
 * (trace-gif.min.js, global TraceAvatarGif) loads from the same folder when a GIF is saved.
 */

import { saveVideoWith } from './export.dom';
import type { SaveVideoOptions, SavedVideo } from './export.dom';
import type { GifJob } from './gif';
import type { TraceController } from '../index';
import { baseOf, loadGlobal } from '../shell/load-global';

export { ExportError } from './export.dom';
export { fileName } from '../core/export';

const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
export const BASE = baseOf(script);

type GifLib = { startGif(o: { width: number; height: number; fps: number; extras?: number[][] }): GifJob };

export function saveVideo(controller: TraceController, opts: SaveVideoOptions = {}): Promise<SavedVideo> {
  return saveVideoWith(controller, opts, {
    gif: () => loadGlobal<GifLib>(`${BASE}trace-gif.min.js`, 'TraceAvatarGif', (g) => !!g && typeof (g as GifLib).startGif === 'function'),
  });
}
