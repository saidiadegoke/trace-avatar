/**
 * <trace-avatar src="/demo.trace.json" controls autoplay></trace-avatar>
 *
 * Custom-element adapter: connected → create, disconnected → destroy,
 * attribute change → rebuild. Events are re-dispatched as DOM events:
 * trace-step, trace-stalled, trace-state, trace-end, trace-error.
 */

import { createTrace } from '../index';
import type { Trace, TraceController, TraceOptions } from '../index';
import type { CaptionMode } from '../shell/renderer.shadow';

const BOOL = ['controls', 'autoplay', 'loop', 'keyboard'] as const;

export class TraceAvatarElement extends HTMLElement {
  static observedAttributes = ['src', 'captions', 'rate', 'takeover', 'avatar-name', 'avatar-image', 'avatar-color', ...BOOL];

  private ctl: TraceController | null = null;
  private obj: Trace | null = null;

  /** Set a trace object directly instead of `src`. */
  get trace(): Trace | null { return this.obj; }
  set trace(t: Trace | null) { this.obj = t; if (this.isConnected) this.rebuild(); }

  get controller(): TraceController | null { return this.ctl; }

  play() { this.ctl?.play(); }
  pause() { this.ctl?.pause(); }
  stop() { this.ctl?.stop(); }
  next() { this.ctl?.next(); }
  prev() { this.ctl?.prev(); }
  seek(ms: number) { this.ctl?.seek(ms); }

  connectedCallback() {
    this.style.display = 'none';
    this.rebuild();
  }

  disconnectedCallback() {
    this.ctl?.destroy();
    this.ctl = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) this.rebuild();
  }

  /** Options read from attributes (exported for tests). */
  options(): TraceOptions | null {
    const src = this.getAttribute('src');
    const trace = this.obj ?? src;
    if (!trace) return null;
    const rate = Number(this.getAttribute('rate'));
    const name = this.getAttribute('avatar-name');
    const image = this.getAttribute('avatar-image');
    const color = this.getAttribute('avatar-color');
    const avatar = name || image || color ? { ...(name ? { name } : {}), ...(image ? { image } : {}), ...(color ? { color } : {}) } : undefined;
    return {
      trace,
      controls: this.hasAttribute('controls'),
      autoplay: this.hasAttribute('autoplay'),
      loop: this.hasAttribute('loop'),
      keyboard: this.hasAttribute('keyboard'),
      captions: (this.getAttribute('captions') as CaptionMode) || undefined,
      takeover: (this.getAttribute('takeover') as 'pause' | 'ignore') || undefined,
      rate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
      avatar,
    };
  }

  private rebuild() {
    this.ctl?.destroy();
    this.ctl = null;
    const o = this.options();
    if (!o) return;
    const fire = (type: string, detail?: unknown) => this.dispatchEvent(new CustomEvent(type, { detail }));
    try {
      const c = createTrace(o);
      c.on('step', (d) => fire('trace-step', d));
      c.on('stalled', (d) => fire('trace-stalled', d));
      c.on('state', (d) => fire('trace-state', d));
      c.on('end', () => fire('trace-end'));
      c.on('error', (d) => fire('trace-error', d));
      this.ctl = c;
    } catch (err) {
      fire('trace-error', err);
    }
  }
}

/** Register the element (again under another name if you like: a constructor can only be registered once). */
export function define(name = 'trace-avatar') {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  const taken = customElements.getName?.(TraceAvatarElement) ?? (customElements.get('trace-avatar') === TraceAvatarElement ? 'trace-avatar' : null);
  customElements.define(name, taken ? class extends TraceAvatarElement {} : TraceAvatarElement);
}

define();
