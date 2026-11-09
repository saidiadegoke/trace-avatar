/**
 * The CDN build of the loader (trace-auto.min.js, global TraceAvatarAuto).
 *
 *   <script src="…/dist/trace-auto.min.js" data-guides="/guides/index.json" defer></script>
 *
 * Attributes on the script tag: data-guides (the manifest; without it nothing mounts, and you call
 * TraceAvatarAuto.mount yourself), data-launcher ("bottom-right" by default, "bottom-left", or "off"),
 * data-perform ("true" allows Do it for me). The player is loaded from the same folder on first play.
 */

import { mount as mountWith } from './mount';
import type { GuidesController, Loaders, MountOptions, PlayerModule } from './mount';
import type { LauncherPosition } from '../shell/launcher.dom';

export { parseManifest, validateManifest, guidesOn, modesOf } from '../core/manifest';
export { GuideError } from './mount';

const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
/** The folder this file was loaded from, where the player sits too. */
export const BASE = script?.src ? script.src.replace(/[^/]*([?#].*)?$/, '') : '';

/** Read the launcher setting from data-launcher. Exported for tests. */
export function launcherOf(v: string | null | undefined): LauncherPosition | false {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'off' || s === 'false' || s === 'none' || s === 'no' || s === '0') return false;
  return s === 'bottom-left' ? 'bottom-left' : 'bottom-right';
}

/** Load a script once and resolve to the global it defines. Exported for tests. */
export function loadGlobal<T>(src: string, name: string, has: (g: unknown) => boolean, doc: Document = document): Promise<T> {
  const w = doc.defaultView as unknown as Record<string, unknown>;
  if (has(w[name])) return Promise.resolve(w[name] as T);
  return new Promise<T>((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => (has(w[name]) ? resolve(w[name] as T) : reject(new Error(`${src} did not define ${name}`)));
    s.onerror = () => reject(new Error(`could not load ${src}`));
    (doc.head ?? doc.documentElement).appendChild(s);
  });
}

export const cdnLoaders = (base: string = BASE, doc?: Document): Loaders => ({
  // trace.min.js also defines TraceAvatar, without the hands: only the perform build will do.
  player: () => loadGlobal<PlayerModule>(`${base}trace-perform.min.js`, 'TraceAvatar', (g) => !!g && typeof (g as { createPerformer?: unknown }).createPerformer === 'function', doc),
});

export function mount(opts: MountOptions, loaders: Partial<Loaders> = {}): GuidesController {
  return mountWith(opts, { ...cdnLoaders(), ...loaders });
}

/** Mount from the script tag's attributes. Exported for tests. */
export function fromScript(el: HTMLScriptElement | null): GuidesController | null {
  const guides = el?.getAttribute('data-guides');
  if (!el || !guides) return null;
  return mount({ guides, launcher: launcherOf(el.getAttribute('data-launcher')), perform: el.getAttribute('data-perform') === 'true' });
}

/** The guides mounted from the script tag, if it had data-guides. */
export let guides: GuidesController | null = null;
if (script) {
  const go = () => { guides = fromScript(script); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
}
