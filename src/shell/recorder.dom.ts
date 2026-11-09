/**
 * The recorder: capture a person using the page into a trace.json.
 *
 *   Observer (DOM events) → throttle → target builder → mask → buffer
 *   stop(): coalesce → simplify path → build → validate
 *
 * Only trusted events count (real input), and never anything inside the
 * overlay or under [data-trace-ignore]. Typed text is masked by default; a
 * demo author marks fields [data-trace-reveal] to keep their text.
 */

import { build } from '../core/build';
import type { Draft, ScrollMode } from '../core/build';
import { parse } from '../core/format';
import type { Avatar, Trace } from '../core/format';
import { isSecret, maskText, shouldMask } from '../core/mask';
import type { FieldFacts } from '../core/mask';
import { next, recClock, recElapsed, recPause, recResume } from '../core/recorder-state';
import type { RecClock, RecorderAction, RecorderState } from '../core/recorder-state';
import { ring } from '../core/ring';
import { createEmitter } from './emitter';
import { buildTarget, meaningful, pagePattern } from './selector.dom';

export interface RecorderOptions {
  /** Where targets are described relative to. Default: document. */
  root?: ParentNode;
  doc?: Document;
  /** Mask typed text unless a field is marked [data-trace-reveal]. Default true. */
  maskByDefault?: boolean;
  /** Pointer sampling interval (ms). Default 33 (~30 Hz). */
  sampleMs?: number;
  /** Pointer samples kept; the oldest are dropped beyond this. Default 108 000 (an hour at 30 Hz). */
  maxSamples?: number;
  /** Keep the pointer path in the trace. Default true. */
  keepPath?: boolean;
  /** Elements to ignore entirely. Default: [data-trace-ignore], the overlay. */
  ignore?: string;
  title?: string;
  avatar?: Avatar;
  /** What the guide needs before it starts (copied to meta.requires), e.g. ['signed-in']. */
  requires?: string[];
  /** Pauses longer than this play back as 1.5 s. Default 4000; 0 keeps real time. */
  maxGapMs?: number;
  /** 'auto' (default) drops scrolls the player does anyway; 'all' keeps every scroll. */
  scrolls?: ScrollMode;
  /** Count synthetic (untrusted) events too. Default false; tests only. */
  allowSynthetic?: boolean;
  now?: () => number;
}

export interface RecorderEvents extends Record<string, unknown> {
  state: { state: RecorderState };
  draft: Draft;
}

export interface Recorder {
  start(): void;
  pause(): void;
  resume(): void;
  /** Stop and return the trace (null when nothing was recorded). */
  stop(): Trace | null;
  readonly state: RecorderState;
  /** Actions captured so far (before merging). */
  readonly count: number;
  on<K extends keyof RecorderEvents>(ev: K, fn: (d: RecorderEvents[K]) => void): () => void;
  destroy(): void;
}

const SKIP_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'file', 'button', 'submit', 'reset', 'image', 'color']);
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);
const LONE_KEYS = new Set(['Enter', 'Escape', 'Tab']);

/** "Mod+Shift+K" from a keydown, or null when the key is just typing. Exported for tests. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mac: boolean): string | null {
  if (MODIFIERS.has(e.key)) return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const extra = mac ? e.ctrlKey : e.metaKey;
  if (!mod && !extra && !e.altKey && !LONE_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (extra) parts.push(mac ? 'Ctrl' : 'Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

/** Facts about a field for the mask rule. Exported for tests. */
export function factsOf(el: Element): FieldFacts {
  return {
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    autocomplete: el.getAttribute('autocomplete') || '',
    name: el.getAttribute('name') || '',
    id: el.id || '',
    marked: !!el.closest('[data-trace-mask]'),
    revealed: !!el.closest('[data-trace-reveal]'),
  };
}

export function createRecorder(opts: RecorderOptions = {}): Recorder {
  const doc = opts.doc ?? document;
  const win = doc.defaultView ?? window;
  const root = opts.root ?? doc;
  const now = opts.now ?? (() => performance.now());
  const sampleMs = opts.sampleMs ?? 33;
  const ignoreSel = opts.ignore ?? '[data-trace-ignore], [data-trace-avatar]';
  const mac = /Mac|iPhone|iPad/.test(win.navigator?.platform || win.navigator?.userAgent || '');
  const emitter = createEmitter<RecorderEvents>();
  const samples = ring(opts.maxSamples ?? 108_000);

  let state: RecorderState = 'idle';
  let clock: RecClock = recClock(0);
  let drafts: Draft[] = [];
  let lastSample = -Infinity;
  let startUrl: string | undefined;
  let touches = 0;
  let pointers = 0;
  const ids = new WeakMap<object, string>();
  let nextId = 0;
  const keyOf = (o: object) => { let k = ids.get(o); if (!k) { nextId += 1; k = `e${nextId}`; ids.set(o, k); } return k; };

  const t = () => recElapsed(clock, now());
  const ignored = (e: Event): boolean => {
    if (!opts.allowSynthetic && !e.isTrusted) return true;
    const el = e.target as Element | null;
    if (!el || typeof (el as Element).closest !== 'function') return false;
    return !!el.closest(ignoreSel) || e.composedPath().some((n) => n instanceof Element && n.hasAttribute('data-trace-avatar'));
  };
  const add = (d: Draft) => {
    const path = win.location?.pathname;
    if (path) d.page = pagePattern(path);
    drafts.push(d);
    emitter.emit('draft', d);
  };

  const onMove = (e: PointerEvent) => {
    if (state !== 'recording' || ignored(e)) return;
    const time = t();
    if (time - lastSample < sampleMs) return;
    lastSample = time;
    samples.push(time, e.clientX, e.clientY);
  };
  const onDown = (e: PointerEvent) => {
    if (state !== 'recording' || ignored(e)) return;
    pointers += 1;
    if (e.pointerType === 'touch') touches += 1;
    const time = t();
    lastSample = time;
    samples.push(time, e.clientX, e.clientY);
  };
  const onClick = (kind: 'click' | 'dblclick') => (e: MouseEvent) => {
    if (state !== 'recording' || ignored(e)) return;
    const el = meaningful(e.target as Element);
    const point = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined;
    add({ kind, t: t(), key: keyOf(el), target: buildTarget(el, { root, point }) });
  };
  const onInput = (e: Event) => {
    if (state !== 'recording' || ignored(e)) return;
    const el = e.target as HTMLElement;
    let value: string;
    if (el instanceof win.HTMLSelectElement) value = el.selectedOptions[0]?.textContent?.trim() ?? el.value;
    else if (el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement) {
      if (el instanceof win.HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) return;
      value = el.value;
    } else if (el.isContentEditable) value = el.textContent ?? '';
    else return;
    const facts = factsOf(el);
    const masked = el instanceof win.HTMLSelectElement ? isSecret(facts) : shouldMask(facts, opts.maskByDefault ?? true);
    add({ kind: 'type', t: t(), key: keyOf(el), target: buildTarget(el, { root }), text: masked ? maskText(value) : value, ...(masked ? { mask: true } : {}) });
  };
  const onKey = (e: KeyboardEvent) => {
    if (state !== 'recording' || ignored(e)) return;
    const keys = comboOf(e, mac);
    if (keys) add({ kind: 'key', t: t(), keys });
  };
  const onScroll = (e: Event) => {
    if (state !== 'recording') return;
    if (!opts.allowSynthetic && !e.isTrusted) return;
    const target = e.target;
    if (target === doc || target === doc.documentElement || target === doc.body || target === win) {
      add({ kind: 'scroll', t: t(), key: 'window', to: { x: Math.round(win.scrollX), y: Math.round(win.scrollY) } });
      return;
    }
    const el = target as Element;
    if (!el || typeof el.closest !== 'function' || el.closest(ignoreSel)) return;
    add({ kind: 'scroll', t: t(), key: keyOf(el), target: buildTarget(el, { root }), to: { x: Math.round(el.scrollLeft), y: Math.round(el.scrollTop) } });
  };

  const listeners: Array<[string, EventListener]> = [
    ['pointermove', onMove as EventListener],
    ['pointerdown', onDown as EventListener],
    ['click', onClick('click') as EventListener],
    ['dblclick', onClick('dblclick') as EventListener],
    ['input', onInput],
    ['change', ((e: Event) => { if (e.target instanceof win.HTMLSelectElement) onInput(e); }) as EventListener],
    ['keydown', onKey as EventListener],
    ['scroll', onScroll],
  ];
  let attached = false;
  const attach = () => {
    if (attached) return;
    listeners.forEach(([type, fn]) => doc.addEventListener(type, fn, { capture: true, passive: true }));
    attached = true;
  };
  const detach = () => {
    if (!attached) return;
    listeners.forEach(([type, fn]) => doc.removeEventListener(type, fn, { capture: true }));
    attached = false;
  };

  const go = (action: RecorderAction) => {
    const to = next(state, action);
    if (to === state) return false;
    const at = now();
    if (action === 'start') {
      clock = recClock(at);
      drafts = [];
      samples.clear();
      lastSample = -Infinity;
      startUrl = win.location?.pathname;
      touches = 0;
      pointers = 0;
      attach();
    } else if (action === 'pause') clock = recPause(clock, at);
    else if (action === 'resume') clock = recResume(clock, at);
    else if (action === 'stop') { clock = recPause(clock, at); detach(); }
    state = to;
    emitter.emit('state', { state });
    return true;
  };

  return {
    start: () => { go('start'); },
    pause: () => { go('pause'); },
    resume: () => { go('resume'); },
    stop() {
      if (!go('stop')) return null;
      const trace = build({
        drafts,
        path: samples.toArray(),
        keepPath: opts.keepPath,
        maxGapMs: opts.maxGapMs,
        scrolls: opts.scrolls,
        avatar: opts.avatar,
        meta: {
          ...(opts.title ? { title: opts.title } : {}),
          ...(opts.requires?.length ? { requires: [...opts.requires] } : {}),
          recordedAt: new Date().toISOString(),
          viewport: { w: win.innerWidth || 1, h: win.innerHeight || 1 },
          // Where playback must begin: the page the recording started on.
          url: startUrl,
          ...(pointers && touches * 2 > pointers ? { pointer: 'touch' as const } : {}),
          ...(samples.dropped ? { truncated: true } : {}),
        },
      });
      if (!trace) return null;
      const checked = parse(trace);
      if (!checked.ok) throw new Error(`trace-avatar recorder built an invalid trace: ${JSON.stringify(checked.errors)}`);
      return trace;
    },
    get state() { return state; },
    get count() { return drafts.length; },
    on: (ev, fn) => emitter.on(ev, fn),
    destroy() { detach(); emitter.clear(); state = 'stopped'; },
  };
}
