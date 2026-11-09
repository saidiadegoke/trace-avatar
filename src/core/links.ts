/**
 * Guide links: `?trace=create-invoice` (or `#trace=…`) opens the app and plays that guide.
 *
 * A link only ever names a guide id from the app's own manifest, never a trace or a trace URL, so
 * nobody can put their own guide (or captions) on the app by sending a link. PURE.
 */

import { GUIDE_ID } from './manifest';
import type { GuideMode } from './manifest';

export interface LinkRequest {
  /** The guide id, or null when the parameter was there but isn't a guide id. */
  id: string | null;
  /** The raw value, for the error message. */
  raw: string;
  mode: GuideMode;
  /** The URL with the link's parameters removed (to replace the address with). */
  cleaned: string;
}

const modeOf = (v: string | null): GuideMode => (v === 'perform' ? 'perform' : 'overlay');

/** Read a guide link from a URL. Null when there is none. */
export function readLink(href: string, param = 'trace'): LinkRequest | null {
  const url = new URL(href);
  const modeParam = `${param}-mode`;
  let raw = url.searchParams.get(param);
  let mode: GuideMode = modeOf(url.searchParams.get(modeParam));
  let fromHash = false;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (raw === null && url.hash && hash.has(param)) {
    raw = hash.get(param);
    mode = modeOf(hash.get(modeParam));
    fromHash = true;
  }
  if (raw === null) return null;
  if (fromHash) {
    hash.delete(param);
    hash.delete(modeParam);
    const rest = hash.toString();
    url.hash = rest ? `#${rest}` : '';
  } else {
    url.searchParams.delete(param);
    url.searchParams.delete(modeParam);
  }
  const id = GUIDE_ID.test(raw) ? raw : null;
  return { id, raw, mode, cleaned: url.href };
}

/** A link that opens `path` (on `origin`) and plays the guide. */
export function makeLink(origin: string, path: string, id: string, mode: GuideMode = 'overlay', param = 'trace'): string {
  const url = new URL(path, origin);
  url.searchParams.set(param, id);
  if (mode === 'perform') url.searchParams.set(`${param}-mode`, 'perform');
  else url.searchParams.delete(`${param}-mode`);
  return url.href;
}

/** A pending link guide, kept across a sign-in redirect. */
export interface Pending { id: string; mode: GuideMode; at: number; /** The viewer already said yes to Do it for me. */ agreed?: boolean }

export const PENDING_MS = 10 * 60_000;

/** Whether a stored value is a usable pending guide at time `now`. */
export function pendingOk(v: unknown, now: number): v is Pending {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Pending>;
  return typeof p.id === 'string' && GUIDE_ID.test(p.id) && (p.mode === 'overlay' || p.mode === 'perform')
    && typeof p.at === 'number' && now - p.at >= 0 && now - p.at < PENDING_MS;
}
