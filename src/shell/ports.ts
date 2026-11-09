/**
 * The seams between the pure core and the browser. Real adapters live next to
 * this file; tests pass fakes (a manual clock, a table of rects, a recording
 * renderer) and run the whole player without a DOM.
 */

import type { NStep, NormalisedTrace, Target } from '../core/format';
import type { LookFn, View, Viewport } from '../core/player';

export interface ClockPort {
  now(): number;
  raf(cb: () => void): number;
  caf(id: number): void;
}

export interface PagePort {
  /** A per-frame, memoised query of where each step's element is. */
  looker(trace: NormalisedTrace, vp: Viewport): LookFn;
  /** The element last resolved for step i (for scroll/reveal effects and events). */
  element(i: number): Element | null;
  viewport(): Viewport;
  /**
   * Whether step i's `wait … until` holds. Checked at most every UNTIL_MS, and only again once the
   * page has changed. Optional: without it, every `until` counts as met.
   */
  until?(trace: NormalisedTrace, now: number): (i: number) => boolean;
  clear(): void;
}

export interface RendererPort {
  apply(v: View, vp: Viewport): void;
  ripple(x: number, y: number): void;
  destroy(): void;
}

export interface InputPort {
  /** Real (trusted) pointer or key input from the viewer, outside the overlay. Returns unsubscribe. */
  watch(cb: (e: PointerEvent | KeyboardEvent) => void): () => void;
}

/** Finds an element for a target, or null. Hosts may add their own in front of the defaults. */
export type Locator = (t: Target, root: ParentNode, step: NStep) => Element | null;

export const browserClock: ClockPort = {
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(() => cb()),
  caf: (id) => cancelAnimationFrame(id),
};
