/**
 * trace-avatar — play a trace as a ghost cursor with a name badge over a live page.
 *
 *   const t = createTrace({ trace, controls: true, autoplay: true });
 *   t.on('step', ({ index }) => …);
 *
 * The facade wires the pure core (format → player → view) to the shell
 * (page, renderer, input, clock) and runs the read → update → write frame loop.
 */

import { parse } from './core/format';
import type { Avatar, NStep, NormalisedTrace, Trace, ValidationError } from './core/format';
import { initial, onPage, update, view } from './core/player';
import type { Config, Effect, Msg, Phase, PlayerState, ResolvedBy, View, Viewport } from './core/player';
import { createEmitter } from './shell/emitter';
import { createInput, isEditable } from './shell/input.dom';
import { createPage } from './shell/page.dom';
import type { Performer } from './shell/perform.dom';
import type { PageOptions } from './shell/page.dom';
import { browserClock } from './shell/ports';
import type { ClockPort, InputPort, Locator, PagePort, RendererPort } from './shell/ports';
import { createRenderer } from './shell/renderer.shadow';
import type { CaptionMode, Command, RendererOptions } from './shell/renderer.shadow';

export { parse, validate, stepAt, labelOf, pageMatches, LIMITS, TIMING, STEP_TYPES } from './core/format';
export type { Trace, Step, Target, Avatar, Meta, NStep, NormalisedTrace, ValidationError, StepType, Point, Until } from './core/format';
export type { Phase, View, ResolvedBy, Look } from './core/player';
export { formatKeys } from './core/player';
export { simplify } from './core/motion';
export { bySelector, byRoleAndName, byText, accessibleName, isUsable, DEFAULT_LOCATORS } from './shell/page.dom';
export type { Locator, ClockPort, PagePort, RendererPort, InputPort } from './shell/ports';
export type { Performer } from './shell/perform.dom';

export interface StepEvent { index: number; step: NStep; resolvedBy: ResolvedBy | null; element: Element | null }
export interface StalledEvent { index: number; step: NStep; reason: 'not-found' | 'wait-timeout' | 'until-timeout' }
/** Perform mode reached a masked field: the viewer types it, then presses play. */
export interface HandoffEvent { index: number; step: NStep; element: Element | null }
/** `prepare` said no (or threw): the guide did not start. */
export interface BlockedEvent { requires: string[]; say: string; error?: unknown }
/** What `prepare` returns: true to start, false (or `{ ok: false, say }`) to block with a message. */
export type PrepareResult = boolean | { ok: boolean; say?: string };
/** The next step happens on another page. `want` may hold `*` segments; `at` is where the viewer is. */
export interface PageEvent { index: number; step: NStep; want: string; at: string }
export interface TraceEvents extends Record<string, unknown> {
  step: StepEvent;
  stalled: StalledEvent;
  page: PageEvent;
  handoff: HandoffEvent;
  blocked: BlockedEvent;
  state: { phase: Phase };
  end: void;
  error: TraceError;
}

export class TraceError extends Error {
  constructor(message: string, public readonly errors: ValidationError[] = []) {
    super(message);
    this.name = 'TraceError';
  }
}

export interface TraceOptions {
  /** A trace object, or the URL of a .trace.json. */
  trace: Trace | string;
  /** Where targets are looked up. Default: document. */
  root?: ParentNode;
  /** Overrides the trace's own avatar. */
  avatar?: Avatar;
  controls?: boolean;
  autoplay?: boolean;
  rate?: number;
  loop?: boolean;
  captions?: CaptionMode;
  /** What real viewer input does while playing. Default 'pause'. */
  takeover?: 'pause' | 'ignore';
  /**
   * Whether a step may scroll the page to bring its element into view.
   * 'auto' (default): yes, until the viewer scrolls the page themselves; from then on the guide leaves the
   * page where they put it, until they next play, pause, step or seek it. 'always': every off-screen element
   * is brought into view. 'never': steps never move the page (for a guide embedded in a page people read on,
   * such as a demo on a landing page). Authored `scroll` steps scroll in every mode.
   */
  scroll?: 'auto' | 'always' | 'never';
  /** Space/K play-pause, ←/→ steps, while focus is not in a field. Default false. */
  keyboard?: boolean;
  /** Overrides the trace's seed. */
  seed?: number;
  /** Default 'auto': follows prefers-reduced-motion. */
  reducedMotion?: boolean | 'auto';
  /**
   * Go to a page the trace needs (e.g. `(path) => router.push(path)`). Without it, the guide waits
   * on the wrong page with "Open /path to continue" until the viewer gets there. Only called for
   * pages without `*` segments, since those name no single address.
   */
  navigate?: (path: string) => void;
  /** Where the viewer is. Default: location.pathname. */
  currentPath?: () => string;
  /**
   * 'overlay' (default) draws over the page. 'perform' also acts on it: clicks, types, presses keys.
   * Perform mode is for sandbox or demo data: a trace can click anything the page allows.
   */
  mode?: 'overlay' | 'perform';
  /**
   * Runs before the guide starts (from the beginning, or again after it ended), with the trace's
   * `meta.requires`. Check your session, sign into a sandbox, or return false / `{ ok: false, say }`
   * to block with a message ("Sign in to start this guide"). Play tries again.
   */
  prepare?: (requires: string[], trace: NormalisedTrace) => PrepareResult | Promise<PrepareResult>;
  /**
   * Perform mode's hands. Kept out of the main bundle: `import { createTrace } from 'trace-avatar/perform'`
   * passes it for you, or pass `createPerformer` from there yourself (React, the custom element).
   */
  performer?: (doc: Document) => Performer;
  /** Perform mode: put the app back before a restart (e.g. reload the sandbox, sign back in). */
  onReset?: () => void | Promise<void>;
  /**
   * Carry on across full page loads: the current step is kept in sessionStorage under this key, and
   * a guide created with the same key (on the next page, within 10 minutes) resumes from the next step.
   */
  resumeKey?: string;
  /** Play from this step (index from 0) instead of the start: carrying on after a step was fixed. */
  startAt?: number;
  /** Extra element locators, tried before the built-in ones. */
  locators?: Locator[];
  /** Replace the browser adapters (tests, embedding). */
  ports?: {
    clock?: ClockPort;
    page?: PagePort;
    input?: InputPort;
    renderer?: (o: RendererOptions) => RendererPort;
  };
}

export interface TraceController {
  /** Resolves when the trace is loaded and parsed (rejects with a TraceError). */
  readonly ready: Promise<void>;
  play(): void;
  pause(): void;
  toggle(): void;
  stop(): void;
  seek(ms: number): void;
  next(): void;
  prev(): void;
  setRate(rate: number): void;
  on<K extends keyof TraceEvents>(ev: K, fn: (data: TraceEvents[K]) => void): () => void;
  readonly state: Phase;
  readonly index: number;
  readonly time: number;
  readonly duration: number;
  readonly trace: NormalisedTrace | null;
  destroy(): void;
}

const RATES = [0.5, 1, 1.5, 2];

function parseOrThrow(raw: unknown, seed?: number): NormalisedTrace {
  const r = parse(raw);
  if (!r.ok) throw new TraceError(`Invalid trace: ${r.errors.map((e) => `${e.path || '(root)'} ${e.message}`).join('; ')}`, r.errors);
  return seed === undefined ? r.trace : { ...r.trace, seed };
}

export function createTrace(opts: TraceOptions): TraceController {
  const win = typeof window !== 'undefined' ? window : undefined;
  /** The viewer's page, or undefined when unknown (then every page matches). */
  const where = (): string | undefined => {
    try { return opts.currentPath ? opts.currentPath() : win?.location?.pathname; } catch { return undefined; }
  };
  const doc = win?.document;
  const clock = opts.ports?.clock ?? browserClock;
  const page = opts.ports?.page ?? createPage({ root: opts.root, locators: opts.locators } as PageOptions);
  const emitter = createEmitter<TraceEvents>();

  const reducedMotion = opts.reducedMotion === undefined || opts.reducedMotion === 'auto'
    ? !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    : opts.reducedMotion;
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const perform = opts.mode === 'perform';
  const cfg: Config = { reducedMotion, loop: !!opts.loop, mac, resumeHint: !!opts.controls, perform };
  if (perform && !opts.performer) {
    throw new TraceError("mode: 'perform' needs a performer: import { createTrace } from 'trace-avatar/perform', or pass performer: createPerformer from there.");
  }
  const hands: Performer | null = perform && doc && opts.performer ? opts.performer(doc) : null;
  /** Perform mode's typing in progress: step i, n characters typed into field. */
  let typing: { i: number; n: number; field: Element } | null = null;
  /** A start is waiting on onReset / prepare. */
  let starting = false;
  /** The guide has started at least once (a later start in perform mode resets the app first). */
  let ran = false;
  let blockedCaption: string | null = null;
  const storeKey = opts.resumeKey ? `trace-avatar:${opts.resumeKey}` : null;
  const RESUME_MS = 10 * 60_000;

  let tr: NormalisedTrace | null = null;
  let s: PlayerState = initial(opts.rate ?? 1);
  let renderer: RendererPort | null = null;
  let unwatch: (() => void) | null = null;
  let raf = 0;
  let destroyed = false;
  let warned = false;
  const pending: Msg[] = [];
  const scrollMode = opts.scroll ?? 'auto';
  /** The viewer scrolled the page since they last told the guide to do something ('auto' then leaves the page alone). */
  let viewerScrolled = false;
  let unscroll: (() => void) | null = null;

  const onCommand = (c: Command) => {
    if (c === 'toggle') dispatch({ kind: 'toggle' });
    else if (c === 'next') dispatch({ kind: 'next' });
    else if (c === 'prev') dispatch({ kind: 'prev' });
    else if (c === 'restart') restart();
    else if (c === 'rate') {
      const k = RATES.indexOf(s.clock.rate);
      dispatch({ kind: 'rate', r: RATES[(k + 1) % RATES.length] });
    }
  };

  function setup(trace: NormalisedTrace) {
    tr = trace;
    const make = opts.ports?.renderer ?? createRenderer;
    renderer = make({
      avatar: { ...trace.avatar, ...opts.avatar },
      captions: opts.captions ?? 'bubble',
      controls: !!opts.controls,
      touch: trace.meta.pointer === 'touch',
      doc,
      onCommand,
      rate: () => s.clock.rate,
    });
    const host = (renderer as { host?: Element }).host ?? null;
    const input = opts.ports?.input ?? (doc ? createInput(doc, () => host) : null);
    unwatch = input?.watch((e) => {
      if (opts.keyboard && e.type === 'keydown' && !isEditable(e.target) && s.phase !== 'idle') {
        const k = (e as KeyboardEvent).key;
        const cmd: Msg | null = k === ' ' || k === 'k' || k === 'K' ? { kind: 'toggle' } : k === 'ArrowRight' ? { kind: 'next' } : k === 'ArrowLeft' ? { kind: 'prev' } : null;
        if (cmd) { e.preventDefault(); dispatch(cmd); return; }
      }
      if ((opts.takeover ?? 'pause') === 'pause') dispatch({ kind: 'takeover' });
    }) ?? null;
    if (scrollMode === 'auto' && doc) unscroll = watchViewerScroll(doc, host, () => { viewerScrolled = true; });
    resume(trace);
    if (opts.startAt !== undefined && opts.startAt > 0 && opts.startAt < trace.steps.length) {
      ran = true;
      s = update(s, { kind: 'jump', i: Math.floor(opts.startAt) }, trace, cfg)[0];
    }
    if (opts.autoplay) dispatch({ kind: 'play' });
    for (const m of pending.splice(0)) dispatch(m);
    render();
  }

  const ready: Promise<void> = typeof opts.trace === 'string'
    ? fetch(opts.trace)
      .then((r) => { if (!r.ok) throw new TraceError(`Could not load trace: HTTP ${r.status}`); return r.json(); })
      .then((raw) => { if (!destroyed) setup(parseOrThrow(raw, opts.seed)); })
      .catch((err) => {
        const e = err instanceof TraceError ? err : new TraceError(`Could not load trace: ${(err as Error).message}`);
        emitter.emit('error', e);
        throw e;
      })
    : (setup(parseOrThrow(opts.trace, opts.seed)), Promise.resolve());
  // Failures are also emitted as 'error'; don't report an unhandled rejection when nobody awaits `ready`.
  ready.catch(() => {});

  function emitPhase(before: Phase) {
    if (s.phase !== before) emitter.emit('state', { phase: s.phase });
  }

  function run(fx: Effect[]) {
    if (!tr) return;
    for (const f of fx) {
      switch (f.fx) {
        case 'step':
          save(f.i);
          emitter.emit('step', { index: f.i, step: tr.steps[f.i], resolvedBy: f.by, element: page.element(f.i) });
          break;
        case 'act':
          act(tr.steps[f.i], f.x, f.y);
          break;
        case 'handoff': {
          const el = page.element(f.i);
          if (el && hands) hands.focus(el);
          emitter.emit('handoff', { index: f.i, step: tr.steps[f.i], element: el });
          break;
        }
        case 'ripple':
          if (!cfg.reducedMotion) renderer?.ripple(f.x, f.y);
          break;
        case 'reveal': {
          if (scrollMode === 'never' || (scrollMode === 'auto' && viewerScrolled)) break;
          const el = page.element(f.i) as (Element & { scrollIntoView?: Element['scrollIntoView'] }) | null;
          el?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: cfg.reducedMotion ? 'auto' : 'smooth' });
          break;
        }
        case 'scroll':
          scrollFor(tr.steps[f.i]);
          break;
        case 'stalled':
          emitter.emit('stalled', { index: f.i, step: tr.steps[f.i], reason: f.reason });
          break;
        case 'page': {
          const at = where() ?? '';
          emitter.emit('page', { index: f.i, step: tr.steps[f.i], want: f.want, at });
          if (opts.navigate && !f.want.split('/').includes('*')) {
            try { opts.navigate(f.want); } catch (e) { emitter.emit('error', new TraceError(`navigate(${f.want}) failed: ${(e as Error)?.message ?? e}`)); }
          }
          break;
        }
        case 'end':
          forget();
          emitter.emit('end', undefined);
          break;
        default: {
          const never: never = f;
          return never;
        }
      }
    }
  }

  function scrollFor(step: NStep) {
    const el = step.target ? page.element(step.i) as HTMLElement | null : null;
    const scrollable = el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    const box: { scrollTo?: (o: ScrollToOptions) => void; scrollBy?: (o: ScrollToOptions) => void } | undefined = scrollable ? el : win;
    const behavior: ScrollBehavior = cfg.reducedMotion ? 'auto' : 'smooth';
    if (step.to) box?.scrollTo?.({ left: step.to.x, top: step.to.y, behavior });
    else if (step.by) box?.scrollBy?.({ left: step.by.x ?? 0, top: step.by.y ?? 0, behavior });
  }

  /** Perform mode: do a step's action. A failure is reported, never thrown into the frame loop. */
  function act(step: NStep, x?: number, y?: number) {
    if (!hands || !doc) return;
    try {
      const el = page.element(step.i) ?? (x !== undefined && y !== undefined ? doc.elementFromPoint?.(x, y) ?? null : null);
      if (step.type === 'key') { hands.key(el, step.keys ?? ''); return; }
      if (!el) return;
      if (step.type === 'click' || step.type === 'dblclick') hands.click(el, x, y, step.type === 'dblclick');
      else if (step.type === 'hover') hands.hover(el, x, y);
      else if (step.type === 'type') { typing = { i: step.i, n: 0, field: hands.startTyping(el) }; keepTyping(); }
    } catch (e) {
      emitter.emit('error', new TraceError(`perform step ${step.i} (${step.type}) failed: ${(e as Error)?.message ?? e}`));
    }
  }

  /** Type as much of the current type step as its timing has reached; `change` when it's done. */
  function keepTyping() {
    if (!typing || !tr || !hands) return;
    const step = tr.steps[typing.i];
    const text = step.text ?? '';
    const t = s.clock.elapsed;
    const span = step.end - step.at;
    const n = t >= step.end || span <= 0 || s.i > typing.i ? text.length : Math.min(text.length, Math.ceil(((t - step.at) / span) * text.length));
    try {
      if (n > typing.n) { hands.typeTo(typing.field, text, typing.n, n); typing.n = n; }
      if (typing.n >= text.length) { hands.finishTyping(typing.field); typing = null; }
    } catch (e) {
      typing = null;
      emitter.emit('error', new TraceError(`perform step ${step.i} (type) failed: ${(e as Error)?.message ?? e}`));
    }
  }

  // Resume across full page loads (sessionStorage; any failure just means no resume).
  function save(i: number) {
    if (!storeKey || !tr) return;
    try { win?.sessionStorage.setItem(storeKey, JSON.stringify({ i, n: tr.steps.length, at: Date.now() })); } catch { /* storage off */ }
  }
  function forget() {
    if (!storeKey) return;
    try { win?.sessionStorage.removeItem(storeKey); } catch { /* storage off */ }
  }
  function resume(trace: NormalisedTrace) {
    if (!storeKey) return;
    let saved: { i?: unknown; n?: unknown; at?: unknown } | null = null;
    try { saved = JSON.parse(win?.sessionStorage.getItem(storeKey) ?? 'null'); } catch { saved = null; }
    if (!saved || typeof saved.i !== 'number' || saved.n !== trace.steps.length || typeof saved.at !== 'number') return;
    const next = saved.i + 1;
    if (Date.now() - saved.at > RESUME_MS || next >= trace.steps.length || !onPage(trace.steps[next], where())) { forget(); return; }
    ran = true;
    s = update(s, { kind: 'jump', i: next }, trace, cfg)[0];
  }

  /** Start from the beginning: reset the app first (perform mode, after a run), then prepare. */
  function start(m: Msg) {
    if (starting || !tr) return;
    const trace = tr;
    const resetFirst = perform && ran && !!opts.onReset;
    if (!resetFirst && !opts.prepare) { ran = true; blockedCaption = null; commit(m); return; }
    starting = true;
    const requires = trace.meta.requires ?? [];
    Promise.resolve()
      .then(() => (resetFirst ? opts.onReset!() : undefined))
      .then(() => (opts.prepare ? opts.prepare(requires, trace) : true))
      .then((res) => {
        starting = false;
        if (destroyed) return;
        const ok = res === true || (typeof res === 'object' && res !== null && res.ok === true);
        if (ok) { ran = true; blockedCaption = null; commit(m); return; }
        block(requires, typeof res === 'object' && res ? res.say : undefined);
      })
      .catch((error) => {
        starting = false;
        if (!destroyed) block(requires, undefined, error);
      });
  }

  function block(requires: string[], say?: string, error?: unknown) {
    blockedCaption = say || (requires.includes('signed-in') ? 'Sign in to start this guide.' : 'This guide can’t start yet.');
    emitter.emit('blocked', { requires, say: blockedCaption, ...(error !== undefined ? { error } : {}) });
    render();
  }

  function restart() {
    dispatch({ kind: 'stop' });
    dispatch({ kind: 'play' });
  }

  function vp(): Viewport { return page.viewport(); }

  function frame() {
    raf = 0;
    if (destroyed || !tr || !renderer) return;
    const viewport = vp();
    const look = page.looker(tr, viewport);
    const before = s.phase;
    const at = where();
    const now = clock.now();
    const met = page.until?.(tr, now);
    const [next, fx] = update(s, { kind: 'frame', now, look, vp: viewport, at, ...(met ? { met } : {}) }, tr, cfg);
    s = next;
    const v: View = view(s, tr, look, cfg, at);
    renderer.apply(v, viewport);
    run(fx);
    keepTyping();
    emitPhase(before);
    if (s.phase === 'playing' || s.phase === 'waiting' || s.phase === 'paused') raf = clock.raf(frame);
  }

  function render() {
    if (destroyed || !tr || !renderer) return;
    if (s.phase === 'idle') {
      if (raf) { clock.caf(raf); raf = 0; }
      const v = view(s, tr, () => null, cfg);
      renderer.apply(blockedCaption ? { ...v, caption: { text: blockedCaption, key: -9 } } : v, vp());
      return;
    }
    if (!raf) raf = clock.raf(frame);
  }

  function dispatch(m: Msg) {
    if (destroyed) {
      if (!warned) { console.warn('[trace-avatar] this trace was destroyed; create a new one.'); warned = true; }
      return;
    }
    if (!tr) { pending.push(m); return; }
    // The viewer is steering the guide again, so it may bring the next element into view again.
    if (/^(play|toggle|pause|next|prev|seek)$/.test(m.kind)) viewerScrolled = false;
    // Starting from the beginning goes through onReset / prepare when the host gave them.
    const fromStart = s.phase === 'idle' || s.phase === 'ended';
    if (fromStart && (m.kind === 'play' || m.kind === 'toggle')) { start(m); return; }
    // Perform mode: seeking to 0 is a restart (the app is reset first).
    if (perform && m.kind === 'seek' && m.t <= 0 && !fromStart) { restart(); return; }
    if (m.kind === 'stop') forget();
    commit(m);
  }

  function commit(m: Msg) {
    if (destroyed || !tr) return;
    const before = s.phase;
    const [next, fx] = update(s, m, tr, cfg);
    s = next;
    run(fx);
    emitPhase(before);
    render();
  }

  return {
    ready,
    play: () => dispatch({ kind: 'play' }),
    pause: () => dispatch({ kind: 'pause' }),
    toggle: () => dispatch({ kind: 'toggle' }),
    stop: () => dispatch({ kind: 'stop' }),
    seek: (ms: number) => dispatch({ kind: 'seek', t: ms }),
    next: () => dispatch({ kind: 'next' }),
    prev: () => dispatch({ kind: 'prev' }),
    setRate: (r: number) => dispatch({ kind: 'rate', r }),
    on: (ev, fn) => emitter.on(ev, fn),
    get state() { return s.phase; },
    get index() { return s.i; },
    get time() { return s.clock.elapsed; },
    get duration() { return tr?.duration ?? 0; },
    get trace() { return tr; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) clock.caf(raf);
      raf = 0;
      unwatch?.();
      unscroll?.();
      renderer?.destroy();
      page.clear();
      emitter.clear();
    },
  };
}

/**
 * Tells when the viewer scrolls the page with the wheel or a touch drag (not the 'scroll' event, which
 * the guide's own scrolling fires too). Scrolling keys and touches already pause the guide (takeover);
 * the wheel doesn't. A wheel over the guide's own controls doesn't count.
 */
function watchViewerScroll(doc: Document, host: Element | null, cb: () => void): () => void {
  const h = (e: Event) => { if (!host || !e.composedPath().includes(host)) cb(); };
  doc.addEventListener('wheel', h, true);
  doc.addEventListener('touchmove', h, true);
  return () => { doc.removeEventListener('wheel', h, true); doc.removeEventListener('touchmove', h, true); };
}
