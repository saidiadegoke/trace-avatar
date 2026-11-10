/**
 * <trace-avatar src="/demo.trace.json" controls autoplay></trace-avatar>
 *
 * Custom-element adapter: connected → create, disconnected → destroy,
 * attribute change → rebuild. Events are re-dispatched as DOM events:
 * trace-step, trace-stalled, trace-page, trace-handoff, trace-blocked, trace-state, trace-end, trace-error.
 * Attributes `mode="perform"` and `resume-key`; functions (prepare, onReset, navigate, performer) go on `.hooks`.
 */

import { createTrace } from '../index';
import type { Trace, TraceController, TraceOptions } from '../index';
import type { CaptionMode } from '../shell/renderer.shadow';
import { securityOf } from '../core/security';
import { mount } from '../auto/index';
import type { GuidesController, MountOptions } from '../auto/index';

const BOOL = ['controls', 'autoplay', 'loop', 'keyboard'] as const;

/** Options that can't be attributes, because they are functions. */
export type Hooks = Pick<TraceOptions, 'prepare' | 'onReset' | 'navigate' | 'currentPath' | 'performer' | 'values'>;

export class TraceAvatarElement extends HTMLElement {
  static observedAttributes = ['src', 'captions', 'rate', 'takeover', 'scroll', 'mode', 'security', 'resume-key', 'avatar-name', 'avatar-image', 'avatar-color', ...BOOL];

  private ctl: TraceController | null = null;
  private obj: Trace | null = null;

  /** Set a trace object directly instead of `src`. */
  get trace(): Trace | null { return this.obj; }
  set trace(t: Trace | null) { this.obj = t; if (this.isConnected) this.rebuild(); }

  get controller(): TraceController | null { return this.ctl; }

  private fns: Hooks = {};
  /** The options that are functions: `prepare`, `onReset`, `navigate`, `currentPath`, `performer`. */
  get hooks(): Hooks { return this.fns; }
  set hooks(h: Hooks) { this.fns = { ...h }; if (this.isConnected) this.rebuild(); }

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
      scroll: (this.getAttribute('scroll') as 'auto' | 'always' | 'never') || undefined,
      ...(this.getAttribute('mode') === 'perform' ? { mode: 'perform' as const } : {}),
      ...(this.hasAttribute('security') ? { security: securityOf(this.getAttribute('security')) } : {}),
      ...(this.getAttribute('resume-key') ? { resumeKey: this.getAttribute('resume-key')! } : {}),
      ...this.fns,
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
      c.on('page', (d) => fire('trace-page', d));
      c.on('handoff', (d) => fire('trace-handoff', d));
      c.on('blocked', (d) => fire('trace-blocked', d));
      c.on('state', (d) => fire('trace-state', d));
      c.on('end', () => fire('trace-end'));
      c.on('error', (d) => fire('trace-error', d));
      this.ctl = c;
    } catch (err) {
      fire('trace-error', err);
    }
  }
}

/** Functions for <trace-guides>, set as its `hooks` property. */
export type GuidesHooks = Pick<MountOptions, 'prepare' | 'onReset' | 'navigate' | 'currentPath' | 'record'>;

/**
 * <trace-guides src="/guides/index.json" launcher="bottom-left" perform links="overlay"></trace-guides>
 *
 * The loader as an element. Events: guides-ready, guides-play, guides-end, guides-stop, guides-error.
 */
export class TraceGuidesElement extends HTMLElement {
  static observedAttributes = ['src', 'launcher', 'perform', 'security', 'controls', 'captions', 'rate', 'links'];
  private g: GuidesController | null = null;
  private fns: GuidesHooks = {};

  get guides(): GuidesController | null { return this.g; }
  get hooks(): GuidesHooks { return this.fns; }
  set hooks(h: GuidesHooks) { this.fns = { ...h }; if (this.isConnected) this.rebuild(); }

  connectedCallback() { this.style.display = 'none'; this.rebuild(); }
  disconnectedCallback() { this.g?.destroy(); this.g = null; }
  attributeChangedCallback() { if (this.isConnected) this.rebuild(); }

  /** Options read from attributes (exported for tests). */
  options(): MountOptions | null {
    const src = this.getAttribute('src');
    if (!src) return null;
    const l = (this.getAttribute('launcher') ?? '').toLowerCase();
    const rate = Number(this.getAttribute('rate'));
    const links = (this.getAttribute('links') ?? '').toLowerCase();
    return {
      guides: src,
      links: links === 'off' || links === 'false' ? false : links === 'overlay' ? 'overlay' : true,
      launcher: l === 'off' || l === 'false' || l === 'none' ? false : l === 'bottom-left' ? 'bottom-left' : 'bottom-right',
      perform: this.hasAttribute('perform'),
      ...(this.hasAttribute('security') ? { security: securityOf(this.getAttribute('security')) } : {}),
      controls: this.getAttribute('controls') !== 'false',
      captions: (this.getAttribute('captions') as CaptionMode) || undefined,
      rate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
      ...this.fns,
    };
  }

  private rebuild() {
    this.g?.destroy();
    this.g = null;
    const o = this.options();
    if (!o) return;
    const fire = (type: string, detail?: unknown) => this.dispatchEvent(new CustomEvent(type, { detail }));
    const g = mount(o);
    g.on('ready', (d) => fire('guides-ready', d));
    g.on('play', (d) => fire('guides-play', d));
    g.on('end', (d) => fire('guides-end', d));
    g.on('stop', (d) => fire('guides-stop', d));
    g.on('error', (d) => fire('guides-error', d));
    this.g = g;
  }
}

/** Register the element (again under another name if you like: a constructor can only be registered once). */
export function define(name = 'trace-avatar') {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  const taken = customElements.getName?.(TraceAvatarElement) ?? (customElements.get('trace-avatar') === TraceAvatarElement ? 'trace-avatar' : null);
  customElements.define(name, taken ? class extends TraceAvatarElement {} : TraceAvatarElement);
}

define();

/** Register <trace-guides>. */
export function defineGuides(name = 'trace-guides') {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  const taken = customElements.getName?.(TraceGuidesElement) ?? (customElements.get('trace-guides') === TraceGuidesElement ? 'trace-guides' : null);
  customElements.define(name, taken ? class extends TraceGuidesElement {} : TraceGuidesElement);
}

defineGuides();
