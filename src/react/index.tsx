/**
 * React adapter. The trace is created on mount and destroyed on unmount, so
 * StrictMode's double mount is correct by construction. Options are compared
 * by value: re-rendering with an equal trace does not rebuild it.
 */

import { useEffect, useRef, useState } from 'react';
import { createTrace } from '../index';
import type { StalledEvent, StepEvent, TraceController, TraceOptions } from '../index';
import type { Phase } from '../core/player';

export interface TraceHandlers {
  onStep?: (e: StepEvent) => void;
  onStalled?: (e: StalledEvent) => void;
  onEnd?: () => void;
  onState?: (phase: Phase) => void;
  onError?: (e: Error) => void;
}

export type UseTraceOptions = TraceOptions & TraceHandlers & { enabled?: boolean };

/** A stable key for the options that require rebuilding the trace. */
export function optionsKey(o: UseTraceOptions): string {
  return JSON.stringify([
    o.trace, o.avatar, o.controls, o.autoplay, o.loop, o.captions, o.takeover, o.keyboard, o.seed, o.reducedMotion, o.enabled ?? true,
  ]);
}

export function useTrace(opts: UseTraceOptions): TraceController | null {
  const [ctl, setCtl] = useState<TraceController | null>(null);
  const handlers = useRef<TraceHandlers>(opts);
  handlers.current = opts;
  const key = optionsKey(opts);

  useEffect(() => {
    if (opts.enabled === false) { setCtl(null); return undefined; }
    let c: TraceController;
    try {
      c = createTrace(opts);
    } catch (err) {
      handlers.current.onError?.(err as Error);
      setCtl(null);
      return undefined;
    }
    const offs = [
      c.on('step', (e) => handlers.current.onStep?.(e)),
      c.on('stalled', (e) => handlers.current.onStalled?.(e)),
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
