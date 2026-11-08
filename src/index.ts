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
import { initial, update, view } from './core/player';
import type { Config, Effect, Msg, Phase, PlayerState, ResolvedBy, View, Viewport } from './core/player';
import { createEmitter } from './shell/emitter';
import { createInput, isEditable } from './shell/input.dom';
import { createPage } from './shell/page.dom';
import type { PageOptions } from './shell/page.dom';
import { browserClock } from './shell/ports';
import type { ClockPort, InputPort, Locator, PagePort, RendererPort } from './shell/ports';
import { createRenderer } from './shell/renderer.shadow';
import type { CaptionMode, Command, RendererOptions } from './shell/renderer.shadow';

export { parse, validate, stepAt, labelOf, LIMITS, TIMING, STEP_TYPES } from './core/format';
export type { Trace, Step, Target, Avatar, Meta, NStep, NormalisedTrace, ValidationError, StepType, Point } from './core/format';
export type { Phase, View, ResolvedBy, Look } from './core/player';
export { formatKeys } from './core/player';
export { simplify } from './core/motion';
export { bySelector, byRoleAndName, byText, accessibleName, isUsable, DEFAULT_LOCATORS } from './shell/page.dom';
export type { Locator, ClockPort, PagePort, RendererPort, InputPort } from './shell/ports';

export interface StepEvent { index: number; step: NStep; resolvedBy: ResolvedBy | null; element: Element | null }
export interface StalledEvent { index: number; step: NStep; reason: 'not-found' | 'wait-timeout' }
export interface TraceEvents extends Record<string, unknown> {
  step: StepEvent;
  stalled: StalledEvent;
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
  /** Space/K play-pause, ←/→ steps, while focus is not in a field. Default false. */
  keyboard?: boolean;
  /** Overrides the trace's seed. */
  seed?: number;
  /** Default 'auto': follows prefers-reduced-motion. */
  reducedMotion?: boolean | 'auto';
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
  const doc = win?.document;
  const clock = opts.ports?.clock ?? browserClock;
  const page = opts.ports?.page ?? createPage({ root: opts.root, locators: opts.locators } as PageOptions);
  const emitter = createEmitter<TraceEvents>();

  const reducedMotion = opts.reducedMotion === undefined || opts.reducedMotion === 'auto'
    ? !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    : opts.reducedMotion;
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const cfg: Config = { reducedMotion, loop: !!opts.loop, mac, resumeHint: !!opts.controls };

  let tr: NormalisedTrace | null = null;
  let s: PlayerState = initial(opts.rate ?? 1);
  let renderer: RendererPort | null = null;
  let unwatch: (() => void) | null = null;
  let raf = 0;
  let destroyed = false;
  let warned = false;
  const pending: Msg[] = [];

  const onCommand = (c: Command) => {
    if (c === 'toggle') dispatch({ kind: 'toggle' });
    else if (c === 'next') dispatch({ kind: 'next' });
    else if (c === 'prev') dispatch({ kind: 'prev' });
    else if (c === 'restart') { dispatch({ kind: 'stop' }); dispatch({ kind: 'play' }); }
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
          emitter.emit('step', { index: f.i, step: tr.steps[f.i], resolvedBy: f.by, element: page.element(f.i) });
          break;
        case 'ripple':
          if (!cfg.reducedMotion) renderer?.ripple(f.x, f.y);
          break;
        case 'reveal': {
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
        case 'end':
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

  function vp(): Viewport { return page.viewport(); }

  function frame() {
    raf = 0;
    if (destroyed || !tr || !renderer) return;
    const viewport = vp();
    const look = page.looker(tr, viewport);
    const before = s.phase;
    const [next, fx] = update(s, { kind: 'frame', now: clock.now(), look, vp: viewport }, tr, cfg);
    s = next;
    const v: View = view(s, tr, look, cfg);
    renderer.apply(v, viewport);
    run(fx);
    emitPhase(before);
    if (s.phase === 'playing' || s.phase === 'waiting' || s.phase === 'paused') raf = clock.raf(frame);
  }

  function render() {
    if (destroyed || !tr || !renderer) return;
    if (s.phase === 'idle') {
      if (raf) { clock.caf(raf); raf = 0; }
      renderer.apply(view(s, tr, () => null, cfg), vp());
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
      renderer?.destroy();
      page.clear();
      emitter.clear();
    },
  };
}
