/**
 * React adapter. The trace is created on mount and destroyed on unmount, so
 * StrictMode's double mount is correct by construction. Options are compared
 * by value: re-rendering with an equal trace does not rebuild it.
 */

import { useEffect, useRef, useState } from 'react';
import { createTrace } from '../index';
import { mount } from '../auto/index';
import type { GuidesController, MountOptions } from '../auto/index';
import type { BlockedEvent, HandoffEvent, PageEvent, StalledEvent, StepEvent, TraceController, TraceOptions } from '../index';
import type { Phase } from '../core/player';

export interface TraceHandlers {
  onStep?: (e: StepEvent) => void;
  onStalled?: (e: StalledEvent) => void;
  /** The next step is on another page (see `navigate`). */
  onPage?: (e: PageEvent) => void;
  /** Perform mode reached a masked field: the viewer types it. */
  onHandoff?: (e: HandoffEvent) => void;
  /** `prepare` said no: the guide did not start. */
  onBlocked?: (e: BlockedEvent) => void;
  onEnd?: () => void;
  onState?: (phase: Phase) => void;
  onError?: (e: Error) => void;
}

export type UseTraceOptions = TraceOptions & TraceHandlers & { enabled?: boolean };

/** A stable key for the options that require rebuilding the trace. */
export function optionsKey(o: UseTraceOptions): string {
  return JSON.stringify([
    o.trace, o.avatar, o.controls, o.autoplay, o.loop, o.captions, o.takeover, o.scroll, o.keyboard, o.seed, o.reducedMotion, o.enabled ?? true,
    o.mode ?? 'overlay', o.resumeKey ?? null,
  ]);
}

export function useTrace(opts: UseTraceOptions): TraceController | null {
  const [ctl, setCtl] = useState<TraceController | null>(null);
  const handlers = useRef<UseTraceOptions>(opts);
  handlers.current = opts;
  const key = optionsKey(opts);

  useEffect(() => {
    if (opts.enabled === false) { setCtl(null); return undefined; }
    let c: TraceController;
    try {
      // Functions are read from the latest render, so a new closure needs no rebuild.
      const h = handlers;
      c = createTrace({
        ...opts,
        navigate: opts.navigate ? (path) => h.current.navigate?.(path) : undefined,
        prepare: opts.prepare ? (requires, trace) => h.current.prepare ? h.current.prepare(requires, trace) : true : undefined,
        onReset: opts.onReset ? () => h.current.onReset?.() : undefined,
        currentPath: opts.currentPath ? () => (h.current.currentPath ?? (() => window.location.pathname))() : undefined,
      });
    } catch (err) {
      handlers.current.onError?.(err as Error);
      setCtl(null);
      return undefined;
    }
    const offs = [
      c.on('step', (e) => handlers.current.onStep?.(e)),
      c.on('stalled', (e) => handlers.current.onStalled?.(e)),
      c.on('page', (e) => handlers.current.onPage?.(e)),
      c.on('handoff', (e) => handlers.current.onHandoff?.(e)),
      c.on('blocked', (e) => handlers.current.onBlocked?.(e)),
      c.on('end', () => handlers.current.onEnd?.()),
      c.on('state', (e) => handlers.current.onState?.(e.phase)),
      c.on('error', (e) => handlers.current.onError?.(e)),
    ];
    setCtl(c);
    return () => { offs.forEach((off) => off()); c.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (ctl && opts.rate !== undefined) ctl.setRate(opts.rate);
  }, [ctl, opts.rate]);

  return ctl;
}

/** Renders nothing itself: the overlay lives in its own shadow root on document.body. */
export function TraceAvatar(props: UseTraceOptions): null {
  useTrace(props);
  return null;
}

export interface TraceGuidesProps extends MountOptions {
  /** Called with the guides controller once mounted (null when unmounted). */
  onReady?: (guides: GuidesController | null) => void;
  onError?: (e: Error) => void;
}

/** A stable key for the options that require remounting the guides. */
export function guidesKey(o: MountOptions): string {
  const r = o.record;
  return JSON.stringify([o.guides, o.launcher ?? 'bottom-right', !!o.perform, o.controls ?? true, o.captions, o.rate, o.avatar, o.links ?? true, o.linkParam ?? 'trace',
    r ? [!!r.save, r.requires, r.maskByDefault, r.shortcut] : null]);
}

/**
 * The loader as a component: a launcher with the manifest's guides, and data-trace-guide buttons.
 * Renders nothing itself. Functions (navigate, prepare, onReset, currentPath, record.allowed, record.save)
 * come from the latest render.
 */
export function TraceGuides(props: TraceGuidesProps): null {
  const latest = useRef(props);
  latest.current = props;
  const key = guidesKey(props);
  useEffect(() => {
    const h = latest;
    const g = mount({
      ...props,
      navigate: props.navigate ? (path) => h.current.navigate?.(path) : undefined,
      prepare: props.prepare ? (requires, trace) => (h.current.prepare ? h.current.prepare(requires, trace) : true) : undefined,
      onReset: props.onReset ? () => h.current.onReset?.() : undefined,
      currentPath: props.currentPath ? () => (h.current.currentPath ?? (() => window.location.pathname))() : undefined,
      record: props.record ? {
        ...props.record,
        allowed: () => h.current.record?.allowed() ?? false,
        save: props.record.save ? (t, e) => h.current.record?.save?.(t, e) : undefined,
      } : undefined,
    });
    const off = g.on('error', (e) => h.current.onError?.(e));
    h.current.onReady?.(g);
    return () => { off(); g.destroy(); h.current.onReady?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
