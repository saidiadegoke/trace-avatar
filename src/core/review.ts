/**
 * The studio's review panel, without the DOM: label, reorder and remove steps, and turn the title
 * into a guide id and a manifest entry. Every function returns new values. PURE.
 */

import { GUIDE_ID } from './manifest';
import type { Guide, GuideMode } from './manifest';
import type { Step } from './format';

/** Every step with its page written out (a trace names a page only where it changes). */
export function expandPages(steps: readonly Step[]): Step[] {
  let page: string | undefined;
  return steps.map((s) => {
    if (s.page) page = s.page;
    return page ? { ...s, page } : { ...s };
  });
}

/** Back to naming a page only where it changes. */
export function compactPages(steps: readonly Step[]): Step[] {
  let page: string | undefined;
  return steps.map((s) => {
    const { page: p, ...rest } = s;
    if (!p || p === page) return rest;
    page = p;
    return { ...rest, page: p };
  });
}

/** Move step i one place up (-1) or down (1). The times stay where they were, so the order plays as shown. */
export function moveStep(steps: readonly Step[], i: number, dir: -1 | 1): Step[] {
  const j = i + dir;
  const out = steps.slice();
  if (i < 0 || j < 0 || i >= out.length || j >= out.length) return out;
  const a = out[i];
  const b = out[j];
  out[i] = { ...b, ...(a.t !== undefined ? { t: a.t } : {}) };
  out[j] = { ...a, ...(b.t !== undefined ? { t: b.t } : {}) };
  if (a.t === undefined) delete out[i].t;
  if (b.t === undefined) delete out[j].t;
  return out;
}

export function removeStep(steps: readonly Step[], i: number): Step[] {
  return steps.filter((_, k) => k !== i);
}

const VERB: Record<string, string> = {
  click: 'Click', dblclick: 'Double-click', type: 'Type in', key: 'Press', scroll: 'Scroll',
  hover: 'Point at', move: 'Move to', wait: 'Wait', note: 'Note', upload: 'Upload to',
};

const cut = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A short human label: `Click "Save"`, `Type in "Customer"`, `Press Mod+K`, `Wait for "Saved"`. */
export function stepLabel(s: Step): string {
  const t = s.target;
  const what = t ? t.name || t.text || t.sel || (t.xy ? `${t.xy.x}, ${t.xy.y}` : '') : '';
  const q = what ? ` "${cut(what)}"` : '';
  if (s.type === 'key') return `Press ${s.keys ?? ''}`.trim();
  if (s.type === 'wait') {
    if (s.until?.gone) return `Wait until${q || ' it'} is gone`;
    if (s.until?.text) return `Wait for "${cut(s.until.text)}"`;
    return `Wait${q}`;
  }
  if (s.type === 'note') return 'Note';
  return `${VERB[s.type] ?? s.type}${q}`;
}

/** A guide id from a title: "Create an invoice" → "create-an-invoice". */
export function guideId(title: string): string {
  const id = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return GUIDE_ID.test(id) ? id : 'guide';
}

/** The pages a guide's steps happen on (for the manifest entry). */
export function pagesOf(steps: readonly Step[]): string[] {
  return Array.from(new Set(steps.map((s) => s.page).filter((p): p is string => !!p)));
}

export interface EntryDraft { id: string; title: string; modes: GuideMode[]; pages: string[] }

/** The manifest entry for a recorded guide, its trace file named after the id. */
export function entryOf(d: EntryDraft): Guide {
  return {
    id: d.id,
    title: d.title.trim(),
    trace: `${d.id}.trace.json`,
    modes: d.modes.length ? d.modes.slice() : ['overlay'],
    ...(d.pages.length ? { pages: d.pages.slice() } : {}),
  };
}
