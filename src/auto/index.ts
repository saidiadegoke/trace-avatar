/**
 * trace-avatar/auto — guides for an app with one call.
 *
 *   import { mount } from 'trace-avatar/auto';
 *   mount({ guides: '/guides/index.json', navigate: (p) => router.push(p) });
 *
 * A corner launcher lists the guides for the page; `data-trace-guide="id"` turns any element into a
 * button for one. The player is loaded on the first play, so the loader alone is all a page pays for
 * until then.
 */

import { mount as mountWith } from './mount';
import type { GuidesController, Loaders, MountOptions } from './mount';

export { ACTIVE_KEY, PENDING_KEY, END_HOLD_MS, GuideError } from './mount';
export { readLink, makeLink, pendingOk, PENDING_MS } from '../core/links';
export type { LinkRequest, Pending } from '../core/links';
export type { GuidesController, GuidesEvents, GuideEvent, Loaders, MountOptions, PlayOptions, PlayerModule, RecordOptions, StudioModule, FixModule } from './mount';
export { matchShortcut } from '../core/shortcut';
export { parseManifest, validateManifest, guidesOn, modesOf, findGuide, MANIFEST_LIMITS, GUIDE_ID } from '../core/manifest';
export type { Guide, GuideMode, Manifest, NGuide, NManifest, ManifestResult } from '../core/manifest';
export type { LauncherPosition } from '../shell/launcher.dom';

/** The npm entry's loaders: the player comes in through import(), so bundlers split it out. */
export const defaultLoaders: Loaders = {
  player: () => import('../perform/index'),
  studio: () => import('../studio/index'),
  fix: () => import('../fix/index'),
};

export function mount(opts: MountOptions, loaders: Partial<Loaders> = {}): GuidesController {
  return mountWith(opts, { ...defaultLoaders, ...loaders });
}
