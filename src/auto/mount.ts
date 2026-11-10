/**
 * The loader's core: a guide manifest, a launcher, `data-trace-guide` buttons, and playing a guide
 * by id. The player is loaded only when a guide is first played (`loaders.player`), so a page that
 * never plays one pays for the loader alone.
 *
 * Entries pass their own loaders: the npm entry uses import(), the CDN build adds a script tag.
 */

import { findGuide, guidesOn, modesOf, parseManifest } from '../core/manifest';
import { makeLink, pendingOk, readLink } from '../core/links';
import type { Pending } from '../core/links';
import type { GuideMode, Manifest, NGuide, NManifest } from '../core/manifest';
import type { Avatar } from '../core/format';
import type { PrepareResult, SeenText, TraceController, TraceOptions } from '../index';
import type { NormalisedTrace } from '../core/format';
import { createEmitter } from '../shell/emitter';
import { createLauncher } from '../shell/launcher.dom';
import type { Launcher, LauncherPosition } from '../shell/launcher.dom';
import type { CaptionMode } from '../shell/renderer.shadow';
import { matchShortcut } from '../core/shortcut';
import { studioWaiting } from '../core/studio-keys';
import type { Studio, StudioOptions } from '../studio/studio.dom';
import type { Fix, FixOptions } from '../fix/index';
import type { Trace } from '../core/format';

export interface PlayerModule { createTrace(o: TraceOptions): TraceController }
export interface StudioModule { createStudio(o: StudioOptions): Studio }
export interface FixModule { offerFix(o: FixOptions): Fix }

export interface Loaders {
  /** The player that plays both modes (trace-avatar/perform). */
  player(): Promise<PlayerModule>;
  /** The studio (trace-avatar/studio), loaded only for an author who may record. */
  studio?: () => Promise<StudioModule>;
  /** "Fix this step" (trace-avatar/fix), loaded only when an author meets a step that can't find its element. */
  fix?: () => Promise<FixModule>;
}

export interface RecordOptions {
  /** Who may record guides. Checked before the studio is loaded; trace-avatar never decides this. */
  allowed: () => boolean | Promise<boolean>;
  /** Where a recorded guide goes (your API, a CMS, a pull request). Default: a download. */
  save?: StudioOptions['save'];
  /** Copied to each guide's meta.requires, e.g. ['signed-in']. */
  requires?: string[];
  /** Mask typed text unless the author reveals a field. Default true. */
  maskByDefault?: boolean;
  /** The shortcut that starts recording. Default 'Alt+Shift+R'; false turns it off. */
  shortcut?: string | false;
  /** AI suggestions in the studio's review: a function calling your backend (see trace-avatar/assist). */
  ai?: StudioOptions['ai'];
}

export interface MountOptions {
  /** A manifest URL, or the manifest itself. */
  guides: string | Manifest;
  /** Where the corner button sits, or false to hide it (use your own data-trace-guide buttons). Default 'bottom-right'. */
  launcher?: LauncherPosition | false;
  /** Allow Do it for me for guides whose manifest entry lists 'perform'. Default false. */
  perform?: boolean;
  navigate?: (path: string) => void;
  prepare?: (requires: string[], trace: NormalisedTrace) => PrepareResult | Promise<PrepareResult>;
  onReset?: () => void | Promise<void>;
  currentPath?: () => string;
  /** The player's controls bar. Default true. */
  controls?: boolean;
  captions?: CaptionMode;
  rate?: number;
  avatar?: Avatar;
  /**
   * Guide links (`?trace=id`, `#trace=id`): true (default), 'overlay' (links play Show me only),
   * or false (ignored). Do it for me from a link always asks the viewer first.
   */
  links?: boolean | 'overlay';
  /** The link parameter. Default 'trace' (and 'trace-mode'). */
  linkParam?: string;
  /**
   * Let authors record guides in the app (the studio): "Record a guide" in the launcher, a shortcut
   * and `?trace-record=1`, all only when `allowed()` says yes.
   */
  record?: RecordOptions;
  /** Where buttons are looked for and the launcher goes. Default: document. */
  doc?: Document;
}

export interface GuideEvent { id: string; mode: GuideMode }
export interface GuidesEvents extends Record<string, unknown> {
  ready: { manifest: NManifest };
  play: GuideEvent & { controller: TraceController };
  end: GuideEvent;
  stop: GuideEvent;
  error: Error;
}

export interface PlayOptions {
  mode?: GuideMode;
  /** Play from this step (index from 0). */
  startAt?: number;
}

export interface GuidesController {
  /** Resolves when the manifest is loaded (rejects when it can't be). */
  readonly ready: Promise<void>;
  readonly manifest: NManifest | null;
  /** The guide playing now. */
  readonly playing: (GuideEvent & { controller: TraceController }) | null;
  /** Play a guide from the manifest by id. Resolves to its controller, or null when it can't play. */
  play(id: string, o?: PlayOptions): Promise<TraceController | null>;
  stop(): void;
  /** The guides offered on a page (default: the viewer's page). */
  list(path?: string): NGuide[];
  /** The modes a guide may be played in here. */
  modes(id: string): GuideMode[];
  /** A link that opens a page (default: this one) and plays the guide. */
  link(id: string, o?: { mode?: GuideMode; path?: string }): string;
  on<K extends keyof GuidesEvents>(ev: K, fn: (d: GuidesEvents[K]) => void): () => void;
  readonly launcher: Launcher | null;
  /** Open the studio and start recording (when `record.allowed()` says yes). */
  record(): Promise<Studio | null>;
  /**
   * Open a guide from the manifest in the studio's review, to change it (when `record.allowed()` says yes).
   * Its save carries `{ from: id }`. Also `?trace-edit=id`.
   */
  edit(id: string): Promise<Studio | null>;
  /** The open studio. */
  readonly studio: Studio | null;
  destroy(): void;
}

/** sessionStorage: the guide playing, so the next page (after a full load) carries on with it. */
export const ACTIVE_KEY = 'trace-avatar:auto:active';
const ACTIVE_MS = 10 * 60_000;
/** sessionStorage: a guide asked for by a link, kept until it really starts (e.g. across a sign-in). */
export const PENDING_KEY = 'trace-avatar:auto:pending';
/** How long the last step stays on screen after a guide ends. */
export const END_HOLD_MS = 2000;

export class GuideError extends Error {
  constructor(message: string, public readonly id?: string) { super(message); this.name = 'GuideError'; }
}

export function mount(opts: MountOptions, loaders: Loaders): GuidesController {
  const doc = opts.doc ?? document;
  const win = doc.defaultView;
  const emitter = createEmitter<GuidesEvents>();
  const performAllowed = !!opts.perform;
  let manifest: NManifest | null = null;
  let base = win?.location?.href ?? 'http://localhost/';
  let current: (GuideEvent & { controller: TraceController }) | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let player: Promise<PlayerModule> | null = null;
  let studio: Studio | null = null;
  let opening: Promise<Studio | null> | null = null;

  const where = (): string | undefined => {
    try { return opts.currentPath ? opts.currentPath() : win?.location?.pathname; } catch { return undefined; }
  };
  /** Errors go to 'error' listeners; with none, to the console, so a typo in an id is never silent. */
  const report = (e: Error) => {
    if (emitter.count('error')) emitter.emit('error', e);
    else console.warn(`[trace-avatar] ${e.message}`);
  };
  const fail = (message: string, id?: string) => { report(new GuideError(message, id)); };

  const store = {
    get(): { id: string; mode: GuideMode; at: number } | null {
      try {
        const v = JSON.parse(win?.sessionStorage.getItem(ACTIVE_KEY) ?? 'null');
        return v && typeof v.id === 'string' && (v.mode === 'overlay' || v.mode === 'perform') && typeof v.at === 'number' ? v : null;
      } catch { return null; }
    },
    set(id: string, mode: GuideMode) { try { win?.sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ id, mode, at: Date.now() })); } catch { /* storage off */ } },
    clear() { try { win?.sessionStorage.removeItem(ACTIVE_KEY); } catch { /* storage off */ } },
  };

  const linksOn = opts.links ?? true;
  const param = opts.linkParam ?? 'trace';
  const pending = {
    get(): Pending | null {
      try { const v: unknown = JSON.parse(win?.sessionStorage.getItem(PENDING_KEY) ?? 'null'); return pendingOk(v, Date.now()) ? v : null; } catch { return null; }
    },
    set(p: Pending) { try { win?.sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* storage off */ } },
    clear() { try { win?.sessionStorage.removeItem(PENDING_KEY); } catch { /* storage off */ } },
  };
  const link = (id: string, o: { mode?: GuideMode; path?: string } = {}) =>
    makeLink(win?.location?.origin ?? 'http://localhost', o.path ?? where() ?? '/', id, o.mode ?? 'overlay', param);
  const copy = async (id: string): Promise<boolean> => {
    try { await win!.navigator.clipboard.writeText(link(id)); return true; } catch { return false; }
  };

  const launcher: Launcher | null = doc.body || doc.documentElement ? createLauncher({
    doc,
    position: opts.launcher || 'bottom-right',
    hidden: opts.launcher === false,
    items: () => (manifest ? guidesOn(manifest, where()) : []).map((g) => ({ id: g.id, title: g.title, modes: modesOf(g, performAllowed) })).filter((g) => g.modes.length),
    onPlay: (id, mode) => { void play(id, { mode }); },
    onStop: () => stop(),
    ...(linksOn ? { onCopy: copy } : {}),
  }) : null;

  /** Guides an author fixed in this session (until the page is left). */
  const fixedTraces = new Map<string, Trace>();
  let fix: Fix | null = null;
  const traceOf = (g: NGuide) => fixedTraces.get(g.id) ?? (typeof g.trace === 'string' ? new URL(g.trace, base).href : g.trace);
  /** A guide's trace as authored: fixed in this session, inline, or fetched from its file. */
  const rawTraceOf = async (g: NGuide): Promise<Trace> => fixedTraces.get(g.id)
    ?? (typeof g.trace === 'string' ? await (await fetch(new URL(g.trace, base).href)).json() : g.trace);
  const loadPlayer = () => (player ??= loaders.player().catch((e) => { player = null; throw e; }));

  function clearCurrent(kind: 'end' | 'stop' | null) {
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    const c = current;
    current = null;
    // A fix waiting to be saved outlives the guide; an unanswered offer goes with it.
    if (fix && fix.state !== 'fixed') { fix.close(); fix = null; }
    store.clear();
    launcher?.setPlaying(false);
    if (!c) return;
    c.controller.destroy();
    if (kind) emitter.emit(kind, { id: c.id, mode: c.mode });
  }

  async function play(id: string, o: PlayOptions = {}, resuming = false): Promise<TraceController | null> {
    if (destroyed) return null;
    try { await ready; } catch { return null; }
    const g = manifest && findGuide(manifest, id);
    if (!g) { fail(`no guide "${id}" in the manifest`, id); return null; }
    const allowed = modesOf(g, performAllowed);
    const mode = o.mode ?? allowed[0];
    if (!mode || !allowed.includes(mode)) {
      fail(mode === 'perform' ? `"${id}" can't be played as Do it for me here (the manifest and mount({ perform: true }) must both allow it)` : `"${id}" has no mode that can play here`, id);
      return null;
    }
    let mod: PlayerModule;
    try { mod = await loadPlayer(); } catch (e) { fail(`could not load the player: ${(e as Error).message}`, id); return null; }
    if (destroyed) return null;
    // Carrying on after a fix replaces the guide quietly (no stop event).
    clearCurrent(current && o.startAt === undefined ? 'stop' : null);
    let c: TraceController;
    try {
      c = mod.createTrace({
        trace: traceOf(g),
        mode,
        controls: opts.controls ?? true,
        autoplay: !resuming,
        resumeKey: `auto:${g.id}`,
        ...(o.startAt !== undefined ? { startAt: o.startAt } : {}),
        ...(opts.captions ? { captions: opts.captions } : {}),
        ...(opts.rate ? { rate: opts.rate } : {}),
        ...(opts.avatar ? { avatar: opts.avatar } : {}),
        ...(opts.navigate ? { navigate: opts.navigate } : {}),
        ...(opts.prepare ? { prepare: opts.prepare } : {}),
        ...(opts.onReset ? { onReset: opts.onReset } : {}),
        ...(opts.currentPath ? { currentPath: opts.currentPath } : {}),
      });
    } catch (e) { fail(`"${id}" could not start: ${(e as Error).message}`, id); return null; }
    const entry = { id: g.id, mode, controller: c };
    current = entry;
    store.set(g.id, mode);
    launcher?.setPlaying(true);
    c.on('error', (e) => { report(new GuideError(e.message, g.id)); });
    c.on('stalled', (d) => { if ((d.reason === 'not-found' || d.reason === 'until-timeout') && current === entry) void offerFix(entry, g, d.index, d.reason, d.seen); });
    c.on('end', () => {
      if (current !== entry) return;
      store.clear();
      endTimer = setTimeout(() => { if (current === entry) clearCurrent('end'); }, END_HOLD_MS);
    });
    try { await c.ready; } catch {
      if (current === entry) clearCurrent(null);
      return null;
    }
    if (resuming) {
      // Carry on only when the player found where it was (it pauses there); otherwise drop it.
      if (c.state !== 'paused') { if (current === entry) clearCurrent(null); return null; }
      c.play();
    }
    if (current === entry) emitter.emit('play', entry);
    return c;
  }

  function stop() { clearCurrent('stop'); }

  /**
   * An author meets a step that can't find its element, or a wait whose text never showed: offer to fix it
   * there. Others see nothing new.
   */
  async function offerFix(entry: GuideEvent & { controller: TraceController }, g: NGuide, index: number, reason: 'not-found' | 'until-timeout', seen?: SeenText[]) {
    if ((fix && fix.state !== 'fixed' && fix.state !== 'closed') || !rec || !loaders.fix) return;
    try { if (!(await rec.allowed())) return; } catch { return; }
    if (current !== entry || destroyed) return;
    let mod: FixModule;
    let raw: Trace;
    try {
      mod = await loaders.fix();
      raw = await rawTraceOf(g);
    } catch (e) { fail(`could not offer a fix: ${(e as Error).message}`, g.id); return; }
    if (current !== entry || destroyed || (fix && fix.state !== 'fixed' && fix.state !== 'closed')) return;
    fix?.close();
    fix = mod.offerFix({
      doc, trace: raw, index, reason, ...(seen ? { seen } : {}), ai: rec.ai,
      entry: { id: g.id, title: g.title, trace: g.trace, ...(g.modes?.length ? { modes: [...g.modes] } : {}), ...(g.pages?.length ? { pages: [...g.pages] } : {}), ...(g.tags?.length ? { tags: [...g.tags] } : {}) },
      ...(rec.save ? { save: rec.save } : {}),
      onFixed: (t, i) => {
        fixedTraces.set(g.id, t);
        // Past the end (the last step was a wait, now met or removed): the guide is done.
        if (i >= t.steps.length) { if (current === entry) clearCurrent('end'); return; }
        void play(g.id, { mode: entry.mode, startAt: i });   // the card stays, to save
      },
      onStop: () => { fix = null; stop(); },
    });
  }

  const onClick = (e: Event) => {
    const t = e.target as Element | null;
    const el = t && typeof t.closest === 'function' ? t.closest('[data-trace-guide]') : null;
    if (!el) return;
    e.preventDefault();
    const m = el.getAttribute('data-trace-mode');
    void play(el.getAttribute('data-trace-guide') ?? '', m === 'perform' || m === 'overlay' ? { mode: m } : {});
  };
  doc.addEventListener('click', onClick);

  const ready: Promise<void> = (async () => {
    let raw: unknown = opts.guides;
    if (typeof opts.guides === 'string') {
      const url = new URL(opts.guides, base).href;
      base = url;
      const r = await fetch(url);
      if (!r.ok) throw new GuideError(`could not load the guides: HTTP ${r.status}`);
      raw = await r.json();
    }
    const p = parseManifest(raw);
    if (!p.ok) throw new GuideError(`invalid guides: ${p.errors.map((e) => `${e.path || '(root)'} ${e.message}`).join('; ')}`);
    if (destroyed) return;
    manifest = p.manifest;
    emitter.emit('ready', { manifest });
  })();
  ready.catch((e) => { if (!destroyed) report(e instanceof Error ? e : new GuideError(String(e))); });

  // A link: remember the guide it names, and take the parameter out of the address so a reload
  // or a shared screenshot doesn't replay it.
  if (win) {
    const req = linksOn ? readLink(win.location.href, param) : null;
    if (req) {
      try { win.history.replaceState(win.history.state, '', req.cleaned); } catch { /* sandboxed */ }
      if (req.id) pending.set({ id: req.id, mode: req.mode, at: Date.now() });
      else void ready.then(() => fail(`"${req.raw}" is not a guide id: a link can only name a guide from the manifest`), () => {});
    }
  }

  /** Play the guide a link asked for. Do it for me asks first; the link is used up once the guide really starts. */
  async function fromLink() {
    const p = pending.get();
    if (!p) { pending.clear(); return; }
    if (!linksOn) { pending.clear(); return; }
    try { await ready; } catch { return; }
    const g = manifest && findGuide(manifest, p.id);
    if (!g) { pending.clear(); fail(`no guide "${p.id}" in the manifest`, p.id); return; }
    let mode: GuideMode = p.mode;
    if (mode === 'perform' && (linksOn === 'overlay' || !modesOf(g, performAllowed).includes('perform'))) mode = 'overlay';
    if (mode === 'perform' && !p.agreed) {
      const answer = launcher ? await launcher.confirm(g.title) : null;
      if (destroyed) return;
      if (!answer) { pending.clear(); return; }
      mode = answer;
      pending.set({ ...p, mode, agreed: answer === 'perform' });
    }
    const c = await play(p.id, { mode });
    if (!c) { pending.clear(); return; }
    // A start that prepare blocked (not signed in yet) keeps the link for the next page.
    if (c.state !== 'idle') { pending.clear(); return; }
    const off = c.on('state', ({ phase }) => { if (phase !== 'idle') { off(); pending.clear(); } });
  }

  // A guide that was playing when the last page unloaded carries on here; otherwise a link's guide plays.
  const active = store.get();
  const resumed: Promise<TraceController | null> = active && Date.now() - active.at < ACTIVE_MS
    ? play(active.id, { mode: active.mode }, true)
    : (active && store.clear(), Promise.resolve(null));
  void resumed.then((c) => {
    if (destroyed) return;
    // One that can't carry on here is forgotten, so it isn't tried (and reported) on every page.
    if (!c && !current) store.clear();
    if (c) pending.clear(); // the guide that carried on wins over an older link
    else void fromLink();
  });

  // ── Recording guides (the studio) ────────────────────────────────────────
  const rec = opts.record;
  const mayRecord = async (): Promise<boolean> => {
    if (!rec || !loaders.studio) return false;
    try { return !!(await rec.allowed()); } catch { return false; }
  };
  /** Open the studio (loading it the first time); `start` begins a recording when none is going on. */
  function openStudio(start: boolean): Promise<Studio | null> {
    if (studio) { if (start && studio.state !== 'recording' && studio.state !== 'paused') studio.start(); return Promise.resolve(studio); }
    return (opening ??= (async () => {
      try {
        if (!(await mayRecord()) || destroyed) return null;
        let mod: StudioModule;
        try { mod = await loaders.studio!(); } catch (e) { fail(`could not load the studio: ${(e as Error).message}`); return null; }
        if (destroyed) return null;
        if (start) clearCurrent(current ? 'stop' : null);
        const s = mod.createStudio({
          doc,
          perform: performAllowed,
          ...(rec!.save ? { save: rec!.save } : {}),
          ...(rec!.requires ? { requires: rec!.requires } : {}),
          ...(rec!.maskByDefault !== undefined ? { maskByDefault: rec!.maskByDefault } : {}),
          ...(rec!.ai ? { ai: rec!.ai } : {}),
          ...(opts.avatar ? { avatar: opts.avatar } : {}),
          ...(opts.navigate ? { navigate: opts.navigate } : {}),
          ...(opts.prepare ? { prepare: opts.prepare } : {}),
          ...(opts.onReset ? { onReset: opts.onReset } : {}),
          ...(opts.currentPath ? { currentPath: opts.currentPath } : {}),
          onClose: () => { if (studio === s) studio = null; },
        });
        studio = s;
        if (start && s.state !== 'recording' && s.state !== 'paused') s.start();
        return s;
      } finally { opening = null; }
    })());
  }
  /** Open a saved guide in the studio's review. */
  async function edit(id: string): Promise<Studio | null> {
    if (!(await mayRecord()) || destroyed) return null;
    try { await ready; } catch { return null; }
    const g = manifest && findGuide(manifest, id);
    if (!g) { fail(`no guide "${id}" in the manifest`, id); return null; }
    let raw: Trace;
    try { raw = await rawTraceOf(g); } catch (e) { fail(`could not load "${id}": ${(e as Error).message}`, id); return null; }
    const s = await openStudio(false);
    if (!s || destroyed) return null;
    clearCurrent(current ? 'stop' : null);
    try {
      s.edit(raw, { id: g.id, title: g.title, ...(g.modes?.length ? { modes: [...g.modes] } : {}), ...(g.pages?.length ? { pages: [...g.pages] } : {}) });
    } catch (e) { fail(`could not edit "${id}": ${(e as Error).message}`, id); return null; }
    return s;
  }
  const onKey = (e: KeyboardEvent) => {
    const sc = rec?.shortcut ?? 'Alt+Shift+R';
    if (!sc || e.repeat || !matchShortcut(sc, e, /Mac|iPhone|iPad/.test(win?.navigator?.platform ?? ''))) return;
    e.preventDefault();
    void openStudio(true);
  };
  if (rec && win) {
    if (rec.shortcut !== false) doc.addEventListener('keydown', onKey);
    void mayRecord().then((ok) => { if (ok && !destroyed) launcher?.setRecord(() => { void openStudio(true); }); });
    // ?trace-record=1 (a convenience: it still needs allowed()), taken out of the address like a link.
    const url = new URL(win.location.href);
    const recParam = `${param}-record`;
    const asked = url.searchParams.has(recParam);
    if (asked) {
      url.searchParams.delete(recParam);
      try { win.history.replaceState(win.history.state, '', url.href); } catch { /* sandboxed */ }
    }
    // ?trace-edit=id opens that guide in the review (it too needs allowed()).
    const editParam = `${param}-edit`;
    const editId = url.searchParams.get(editParam);
    if (editId !== null) {
      url.searchParams.delete(editParam);
      try { win.history.replaceState(win.history.state, '', url.href); } catch { /* sandboxed */ }
    }
    // A recording or a review going on when the last page unloaded carries on here.
    if (editId) void edit(editId);
    else if (asked || studioWaiting((k) => win.sessionStorage.getItem(k))) void openStudio(asked);
  }

  return {
    ready,
    get manifest() { return manifest; },
    get playing() { return current; },
    play: (id, o) => play(id, o),
    stop,
    list: (path) => (manifest ? guidesOn(manifest, path ?? where()) : []),
    modes: (id) => { const g = manifest && findGuide(manifest, id); return g ? modesOf(g, performAllowed) : []; },
    link,
    on: (ev, fn) => emitter.on(ev, fn),
    launcher,
    record: () => openStudio(true),
    edit: (id) => edit(id),
    get studio() { return studio; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.removeEventListener('keydown', onKey);
      studio?.destroy();
      studio = null;
      if (endTimer) clearTimeout(endTimer);
      current?.controller.destroy();
      current = null;
      doc.removeEventListener('click', onClick);
      launcher?.destroy();
      emitter.clear();
    },
  };
}
