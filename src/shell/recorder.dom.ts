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
import { REC_PERSIST_MS, SIGN_IN_NOTE, cameFromElsewhere, clockAt, resumeElapsed, savedOk, trimPath } from '../core/rec-store';
import type { SavedRecording } from '../core/rec-store';
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
  /**
   * Carry on across full page loads: the recording is kept in sessionStorage under this key, and a
   * recorder created with the same key on the next page (same tab, same site) picks it up.
   */
  persistKey?: string;
  /** A kept recording older than this is dropped. Default 30 minutes. */
  persistMs?: number;
  /** Count synthetic (untrusted) events too. Default false; tests only. */
  allowSynthetic?: boolean;
  now?: () => number;
  /** Wall clock, for carrying on across page loads. Tests only. */
  wall?: () => number;
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
  /** It carried on with a recording from the last page (persistKey). */
  readonly restored: boolean;
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
  let signin = false;
  let restored = false;
  const wall = opts.wall ?? (() => Date.now());
  const storeKey = opts.persistKey ? `trace-avatar:rec:${opts.persistKey}` : null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
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
    // A click or a key can leave the page at once (a link, a form): keep it now. Typing and scrolls can wait.
    if (d.kind === 'type' || d.kind === 'scroll') scheduleSave(); else save();
  };

  // Carrying on across page loads.
  const origin = (() => { try { return win.location.origin; } catch { return ''; } })();
  function save() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!storeKey || (state !== 'recording' && state !== 'paused')) return;
    const elapsed = t();
    const data: SavedRecording = {
      v: 1, state, elapsed, savedAt: wall(), origin, drafts, path: trimPath(samples.toArray(), elapsed),
      ...(startUrl ? { startUrl } : {}), touches, pointers, ...(signin ? { signin } : {}),
    };
    try { win.sessionStorage.setItem(storeKey, JSON.stringify(data)); } catch {
      // Over the quota: the steps matter, the pointer path doesn't.
      try { win.sessionStorage.setItem(storeKey, JSON.stringify({ ...data, path: [] })); } catch { /* storage off */ }
    }
  }
  function scheduleSave() {
    if (!storeKey || saveTimer) return;
    saveTimer = setTimeout(save, 300);
  }
  function forget() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!storeKey) return;
    try { win.sessionStorage.removeItem(storeKey); } catch { /* storage off */ }
  }
  const onHide = () => save();

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
      signin = false;
      attach();
    } else if (action === 'pause') clock = recPause(clock, at);
    else if (action === 'resume') clock = recResume(clock, at);
    else if (action === 'stop') { clock = recPause(clock, at); detach(); }
    state = to;
    if (to === 'stopped') forget(); else save();
    emitter.emit('state', { state });
    return true;
  };

  if (storeKey) {
    win.addEventListener('pagehide', onHide);
    let kept: unknown = null;
    try { kept = JSON.parse(win.sessionStorage.getItem(storeKey) ?? 'null'); } catch { kept = null; }
    if (savedOk(kept, wall(), opts.persistMs ?? REC_PERSIST_MS) && kept.origin === origin) {
      drafts = kept.drafts;
      for (let i = 0; i + 2 < kept.path.length; i += 3) samples.push(kept.path[i], kept.path[i + 1], kept.path[i + 2]);
      startUrl = kept.startUrl;
      touches = kept.touches;
      pointers = kept.pointers;
      signin = !!kept.signin;
      clock = clockAt(now(), resumeElapsed(kept, wall()), kept.state === 'paused');
      state = kept.state;
      restored = true;
      attach();
      // Back from another site (a sign-in): the guide hands that part to the viewer.
      if (cameFromElsewhere(doc.referrer, origin)) {
        signin = true;
        add({ kind: 'note', t: kept.elapsed, say: SIGN_IN_NOTE, pause: true });
      }
      save();
    } else if (kept !== null) forget();
  }

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
          ...(opts.requires?.length || signin ? { requires: Array.from(new Set([...(opts.requires ?? []), ...(signin ? ['signed-in'] : [])])) } : {}),
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
    get restored() { return restored; },
    on: (ev, fn) => emitter.on(ev, fn),
    destroy() {
      detach();
      forget();
      if (storeKey) win.removeEventListener('pagehide', onHide);
      emitter.clear();
      state = 'stopped';
    },
  };
}
