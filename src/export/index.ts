/**
 * trace-avatar/export: "Save as video" for a guide on this page, as a GIF or a video file.
 *
 *   import { saveVideo } from 'trace-avatar/export';
 *   const v = await saveVideo(controller, { format: 'gif', area: document.querySelector('#app') });
 *   v.download();
 *
 * The GIF encoder (gifenc, in a worker) loads only when a GIF is saved.
 */

import { saveVideoWith } from './export.dom';
import type { SaveVideoOptions, SavedVideo } from './export.dom';
import type { TraceController } from '../index';

export { ExportError } from './export.dom';
export type { SaveVideoOptions, SavedVideo, ExportReason } from './export.dom';
export { fileName } from '../core/export';

export function saveVideo(controller: TraceController, opts: SaveVideoOptions = {}): Promise<SavedVideo> {
  return saveVideoWith(controller, opts, { gif: () => import('./gif') });
}
