/**
 * The CDN build of the studio (trace-studio.min.js, global TraceAvatarStudio). The loader
 * (trace-auto.min.js) fetches it from its own folder when an allowed author records a guide; the
 * player for test plays comes from the same folder on first use.
 */

import { createStudio as createWith } from './studio.dom';
import type { Studio, StudioLoaders, StudioOptions, StudioPlayer } from './studio.dom';
import { baseOf, hasPerformer, loadGlobal } from '../shell/load-global';

export { STUDIO_CSS } from './studio.dom';
export { guideId, entryOf, stepLabel } from '../core/review';

const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
export const BASE = baseOf(script);

export const cdnStudioLoaders = (base: string = BASE, doc?: Document): StudioLoaders => ({
  player: () => loadGlobal<StudioPlayer>(`${base}trace-perform.min.js`, 'TraceAvatar', hasPerformer, doc),
});

export function createStudio(opts: StudioOptions = {}, loaders: Partial<StudioLoaders> = {}): Studio {
  return createWith(opts, { ...cdnStudioLoaders(BASE, opts.doc), ...loaders });
}
