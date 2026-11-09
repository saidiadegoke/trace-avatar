/**
 * The guide manifest: which guides an app offers, in which modes, on which pages.
 *
 *   { "version": 1, "guides": [{ "id": "create-invoice", "title": "Create an invoice",
 *     "trace": "create-invoice.trace.json", "modes": ["overlay", "perform"], "pages": ["/app/invoices"] }] }
 *
 * Only guides listed here can be played by the loader, its buttons and its links: a link names an
 * id, never a trace. PURE.
 */

import { pageMatches } from './format';
import type { Trace, ValidationError } from './format';

export type GuideMode = 'overlay' | 'perform';

export interface Guide {
  id: string;
  title: string;
  /** A trace URL (relative to the manifest) or the trace itself. */
  trace: string | Trace;
  /** What the launcher offers. Default ['overlay']. */
  modes?: GuideMode[];
  /** Pages the launcher lists it on (`*` = one segment). Default: every page. */
  pages?: string[];
  tags?: string[];
}

export interface Manifest {
  version: 1;
  guides: Guide[];
}

export interface NGuide {
  readonly id: string;
  readonly title: string;
  readonly trace: string | Trace;
  readonly modes: readonly GuideMode[];
  readonly pages: readonly string[];
  readonly tags: readonly string[];
}

export interface NManifest {
  readonly version: 1;
  readonly guides: readonly NGuide[];
}

export type ManifestResult = { ok: true; manifest: NManifest; errors: [] } | { ok: false; errors: ValidationError[] };

export const MANIFEST_LIMITS = { guides: 200, title: 120, pages: 50, tags: 20 } as const;
export const GUIDE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MODES: readonly GuideMode[] = ['overlay', 'perform'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every problem with a manifest, each with a path to it. */
export function validateManifest(raw: unknown): { ok: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => { errors.push({ path, message }); };
  if (!isObj(raw)) { err('', 'a manifest is an object'); return { ok: false, errors }; }
  if (raw.version !== 1) err('version', 'must be 1');
  if (!Array.isArray(raw.guides)) { err('guides', 'must be a list'); return { ok: false, errors }; }
  if (raw.guides.length > MANIFEST_LIMITS.guides) err('guides', `at most ${MANIFEST_LIMITS.guides} guides`);
  const seen = new Set<string>();
  raw.guides.forEach((g: unknown, k: number) => {
    const p = `guides[${k}]`;
    if (!isObj(g)) { err(p, 'a guide is an object'); return; }
    if (typeof g.id !== 'string' || !GUIDE_ID.test(g.id)) err(`${p}.id`, 'letters, digits, - and _ (at most 64), starting with a letter or digit');
    else if (seen.has(g.id)) err(`${p}.id`, `"${g.id}" is used twice`);
    else seen.add(g.id);
    if (typeof g.title !== 'string' || !g.title.trim() || g.title.length > MANIFEST_LIMITS.title) err(`${p}.title`, `a title is needed (at most ${MANIFEST_LIMITS.title} characters)`);
    if (!(typeof g.trace === 'string' && g.trace.trim()) && !isObj(g.trace)) err(`${p}.trace`, 'a trace URL or a trace object');
    if (g.modes !== undefined) {
      if (!Array.isArray(g.modes) || !g.modes.length) err(`${p}.modes`, 'a non-empty list of "overlay" and "perform"');
      else {
        g.modes.forEach((m: unknown, j: number) => { if (!MODES.includes(m as GuideMode)) err(`${p}.modes[${j}]`, 'must be "overlay" or "perform"'); });
        if (new Set(g.modes).size !== g.modes.length) err(`${p}.modes`, 'each mode once');
      }
    }
    for (const [key, max] of [['pages', MANIFEST_LIMITS.pages], ['tags', MANIFEST_LIMITS.tags]] as const) {
      const list = g[key];
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.length > max) { err(`${p}.${key}`, `a list of at most ${max}`); continue; }
      list.forEach((v: unknown, j: number) => {
        if (typeof v !== 'string' || !v) err(`${p}.${key}[${j}]`, 'must be a non-empty string');
        else if (key === 'pages' && !v.startsWith('/')) err(`${p}.${key}[${j}]`, 'a page starts with /');
      });
    }
  });
  return { ok: errors.length === 0, errors };
}

/** Validate and fill in defaults. */
export function parseManifest(raw: unknown): ManifestResult {
  const v = validateManifest(raw);
  if (!v.ok) return { ok: false, errors: v.errors };
  const m = raw as Manifest;
  return {
    ok: true,
    errors: [],
    manifest: {
      version: 1,
      guides: m.guides.map((g) => ({
        id: g.id,
        title: g.title.trim(),
        trace: g.trace,
        modes: g.modes ? [...g.modes] : ['overlay'],
        pages: g.pages ? [...g.pages] : [],
        tags: g.tags ? [...g.tags] : [],
      })),
    },
  };
}

/** The guides offered on a page (all of them when the page is unknown). */
export function guidesOn(m: NManifest, path?: string): NGuide[] {
  return m.guides.filter((g) => path === undefined || !g.pages.length || g.pages.some((p) => pageMatches(p, path)));
}

/** The modes a guide may be played in: Do it for me only when the guide and the app both allow it. */
export function modesOf(g: NGuide, performAllowed: boolean): GuideMode[] {
  return g.modes.filter((m) => m === 'overlay' || performAllowed);
}

export function findGuide(m: NManifest, id: string): NGuide | undefined {
  return m.guides.find((g) => g.id === id);
}
