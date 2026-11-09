/**
 * trace-avatar/studio — record a guide inside your app, review it, test it, save it.
 *
 *   import { createStudio } from 'trace-avatar/studio';
 *   const studio = createStudio({ save: (trace, entry) => api.saveGuide(trace, entry) });
 *   studio.start();
 *
 * Usually you don't call this yourself: `mount({ record: { allowed, save } })` from trace-avatar/auto
 * loads the studio when an allowed author picks "Record a guide". The player for test plays is
 * loaded on first use.
 */

import { createStudio as createWith } from './studio.dom';
import type { Studio, StudioLoaders, StudioOptions } from './studio.dom';

export { STUDIO_CSS } from './studio.dom';
export type { Studio, StudioEvents, StudioLoaders, StudioOptions, StudioPlayer, StudioState } from './studio.dom';
export { STUDIO_PERSIST, STUDIO_REC_KEY, STUDIO_REVIEW_KEY, studioWaiting } from '../core/studio-keys';
export { compactPages, entryOf, expandPages, guideId, moveStep, pagesOf, removeStep, stepLabel } from '../core/review';
export type { EntryDraft } from '../core/review';

export const defaultStudioLoaders: StudioLoaders = {
  player: () => import('../perform/index'),
  assist: () => import('./assist-ui'),
};

export function createStudio(opts: StudioOptions = {}, loaders: Partial<StudioLoaders> = {}): Studio {
  return createWith(opts, { ...defaultStudioLoaders, ...loaders });
}
