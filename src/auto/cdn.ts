/**
 * The CDN build of the loader (trace-auto.min.js, global TraceAvatarAuto).
 *
 *   <script src="…/dist/trace-auto.min.js" data-guides="/guides/index.json" defer></script>
 *
 * Attributes on the script tag: data-guides (the manifest; without it nothing mounts, and you call
 * TraceAvatarAuto.mount yourself), data-launcher ("bottom-right" by default, "bottom-left", or "off"),
 * data-perform ("true" allows Do it for me), data-links ("overlay": links play Show me only; "off").
 * The player is loaded from the same folder on first play.
 */

import { mount as mountWith } from './mount';
import type { GuidesController, Loaders, MountOptions, PlayerModule, StudioModule } from './mount';
import type { LauncherPosition } from '../shell/launcher.dom';
import { baseOf, hasPerformer, loadGlobal } from '../shell/load-global';

export { loadGlobal };

export { parseManifest, validateManifest, guidesOn, modesOf } from '../core/manifest';
export { GuideError } from './mount';

const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
/** The folder this file was loaded from, where the player sits too. */
export const BASE = baseOf(script);

/** Read the launcher setting from data-launcher. Exported for tests. */
export function launcherOf(v: string | null | undefined): LauncherPosition | false {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'off' || s === 'false' || s === 'none' || s === 'no' || s === '0') return false;
  return s === 'bottom-left' ? 'bottom-left' : 'bottom-right';
}

export const cdnLoaders = (base: string = BASE, doc?: Document): Loaders => ({
  player: () => loadGlobal<PlayerModule>(`${base}trace-perform.min.js`, 'TraceAvatar', hasPerformer, doc),
  studio: () => loadGlobal<StudioModule>(`${base}trace-studio.min.js`, 'TraceAvatarStudio', (g) => typeof (g as Partial<StudioModule> | undefined)?.createStudio === 'function', doc),
});

export function mount(opts: MountOptions, loaders: Partial<Loaders> = {}): GuidesController {
  return mountWith(opts, { ...cdnLoaders(), ...loaders });
}

/** Mount from the script tag's attributes. Exported for tests. */
export function fromScript(el: HTMLScriptElement | null): GuidesController | null {
  const guides = el?.getAttribute('data-guides');
  if (!el || !guides) return null;
  const links = (el.getAttribute('data-links') ?? '').toLowerCase();
  return mount({
    guides,
    launcher: launcherOf(el.getAttribute('data-launcher')),
    perform: el.getAttribute('data-perform') === 'true',
    links: links === 'off' || links === 'false' ? false : links === 'overlay' ? 'overlay' : true,
  });
}

/** The guides mounted from the script tag, if it had data-guides. */
export let guides: GuidesController | null = null;
if (script) {
  const go = () => { guides = fromScript(script); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
}
