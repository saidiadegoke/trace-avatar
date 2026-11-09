/**
 * The overlay: one fixed, click-through layer in its own shadow root.
 *
 * It applies a `View` and writes only what changed since the last one
 * (dirty checking instead of a virtual DOM). Ripples come from a pool of four
 * nodes, restarted by alternating two identical animations, so nothing forces
 * a reflow and nothing is created per click.
 */

import type { Avatar } from '../core/format';
import type { View, Viewport } from '../core/player';
import type { RendererPort } from './ports';

export type CaptionMode = 'bubble' | 'bar' | 'none';
export type Command = 'toggle' | 'next' | 'prev' | 'restart' | 'rate';

export interface RendererOptions {
  avatar: Avatar;
  captions: CaptionMode;
  controls: boolean;
  touch: boolean;
  doc?: Document;
  onCommand?: (c: Command) => void;
  /** Current rate, for the speed button label. */
  rate?: () => number;
}

export const CSS_TEXT = `
:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:var(--ta-z,2147483000);
--c:var(--ta-color,#2456d8);--bb:var(--ta-badge-bg,#111827);--bf:var(--ta-badge-fg,#f9fafb);
--cb:var(--ta-caption-bg,#111827);--cf:var(--ta-caption-fg,#f9fafb);
--ring:var(--ta-ring,color-mix(in srgb,var(--c) 30%,transparent));--f:var(--ta-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
@media (prefers-color-scheme:dark){:host{--bb:var(--ta-badge-bg,#f9fafb);--bf:var(--ta-badge-fg,#111827);--cb:var(--ta-caption-bg,#f9fafb);--cf:var(--ta-caption-fg,#111827)}}
.cur{position:absolute;left:0;top:0;opacity:0;transition:opacity .2s;will-change:transform}
.cur.on{opacity:1}
.ptr{display:block;width:22px;height:22px;transform-origin:3px 3px;transition:transform .09s}
.ptr path{fill:var(--c);stroke:#fff;stroke-width:1.5;stroke-linejoin:round}
.cur.down .ptr{transform:scale(.8)}
.dot{display:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:color-mix(in srgb,var(--c) 40%,transparent);border:2px solid var(--c);box-sizing:border-box}
.touch .ptr{display:none}.touch .dot{display:block}.touch.down .dot{transform:scale(.8)}
.badge{position:absolute;left:18px;top:20px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;background:var(--bb);color:var(--bf);font:500 12px/1.2 var(--f);padding:3px 10px 3px 3px;border-radius:999px;box-shadow:0 4px 12px rgb(0 0 0/.18)}
.av{width:20px;height:20px;border-radius:50%;object-fit:cover;background:var(--c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font:700 10px/1 var(--f)}
.bubble,.chip{position:absolute;left:18px;width:max-content}
.bubble{top:50px;max-width:280px;background:var(--cb);color:var(--cf);font:13px/1.45 var(--f);padding:8px 11px;border-radius:10px;box-shadow:0 6px 18px rgb(0 0 0/.2);opacity:0;transform:translateY(4px);transition:opacity .2s,transform .2s}
.bubble.on{opacity:1;transform:none}
.chip{top:-30px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:pre;background:var(--c);color:#fff;font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px 8px;border-radius:6px;display:none}
.chip.on{display:block}
.cur.left .badge,.cur.left .bubble,.cur.left .chip{left:auto;right:8px}
.cur.up .bubble{top:auto;bottom:12px}
.ring{position:absolute;left:0;top:0;box-sizing:border-box;border:2px solid var(--c);box-shadow:0 0 0 4px var(--ring);border-radius:8px;opacity:0;transition:opacity .25s;will-change:transform}
.ring.on{opacity:1}
.rip{position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;box-sizing:border-box;border:2px solid var(--c);border-radius:50%;opacity:0}
.rip.a{animation:ta1 .45s ease-out}.rip.b{animation:ta2 .45s ease-out}
@keyframes ta1{from{transform:var(--p) scale(.3);opacity:1}to{transform:var(--p) scale(1.8);opacity:0}}
@keyframes ta2{from{transform:var(--p) scale(.3);opacity:1}to{transform:var(--p) scale(1.8);opacity:0}}
.bar{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);width:max-content;max-width:min(640px,calc(100vw - 32px));box-sizing:border-box;background:var(--cb);color:var(--cf);font:14px/1.5 var(--f);padding:10px 16px;border-radius:12px;box-shadow:0 6px 18px rgb(0 0 0/.2);opacity:0;transition:opacity .2s}
.bar.on{opacity:1}.ctl-on .bar{bottom:72px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ctl{position:absolute;right:16px;bottom:16px;pointer-events:auto;display:flex;align-items:center;gap:2px;background:var(--bb);color:var(--bf);border-radius:999px;padding:4px;font:12px/1 var(--f);box-shadow:0 4px 14px rgb(0 0 0/.2)}
.ctl button{all:unset;cursor:pointer;min-width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font:14px/1 var(--f);padding:0 4px;box-sizing:border-box}
.ctl button:hover{background:color-mix(in srgb,var(--bf) 14%,transparent)}
.ctl button:focus-visible{outline:2px solid var(--c);outline-offset:1px}
.ctl .n{padding:0 8px;opacity:.8;font-variant-numeric:tabular-nums}
.ctl .rate{font-size:12px;padding:0 8px}
@media (prefers-reduced-motion:reduce){.cur,.ring,.bubble,.bar,.ptr{transition:none}.rip{display:none}}
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => /\p{L}|\p{N}/u.test(p[0] || ''));
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '•';
}

/** Badge text without anything after a "·" (e.g. "Sarah · Sales" keeps both; initials use "Sarah"). */
const firstPart = (name: string) => name.split('·')[0];

export function createRenderer(o: RendererOptions): RendererPort & { host: HTMLElement; root: ShadowRoot } {
  const doc = o.doc ?? document;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: Node): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  };

  const host = el('div');
  host.setAttribute('data-trace-avatar', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style', undefined, root);
  style.textContent = CSS_TEXT;
  const shell = el('div', o.controls ? 'ctl-on' : '', root);

  const ring = el('div', 'ring', shell);
  const ripples = Array.from({ length: 4 }, () => el('div', 'rip', shell));
  const cur = el('div', `cur${o.touch ? ' touch' : ''}`, shell);
  cur.setAttribute('aria-hidden', 'true');
  if (o.avatar.color) host.style.setProperty('--ta-color', o.avatar.color);

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ptr');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M3 2.5l15.5 7.6-6.6 1.9-3 6.4z');
  svg.appendChild(path);
  cur.appendChild(svg);
  el('div', 'dot', cur);

  const name = o.avatar.name?.trim() || '';
  if (name || o.avatar.image) {
    const badge = el('div', 'badge', cur);
    if (o.avatar.image) {
      const img = el('img', 'av', badge);
      img.alt = '';
      img.src = o.avatar.image;
    } else {
      el('span', 'av', badge).textContent = initials(firstPart(name));
    }
    if (name) el('span', 'name', badge).textContent = name;
  }
  const chip = el('div', 'chip', cur);
  const bubble = el('div', 'bubble', cur);

  // One live region for screen readers; in 'bar' mode it is also the visible caption.
  const live = el('div', o.captions === 'bar' ? 'bar' : 'sr', shell);
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  let counter: HTMLElement | null = null;
  let playBtn: HTMLButtonElement | null = null;
  let rateBtn: HTMLButtonElement | null = null;
  if (o.controls) {
    const bar = el('div', 'ctl', shell);
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Guide controls');
    const btn = (label: string, text: string, cmd: Command, cls?: string) => {
      const b = el('button', cls, bar);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.textContent = text;
      b.addEventListener('click', () => o.onCommand?.(cmd));
      return b;
    };
    btn('Previous step', '⏮', 'prev');
    playBtn = btn('Play', '▶', 'toggle');
    btn('Next step', '⏭', 'next');
    rateBtn = btn('Playback speed', '1×', 'rate', 'rate');
    counter = el('span', 'n', bar);
    btn('Restart', '↺', 'restart');
  }

  (doc.body ?? doc.documentElement).appendChild(host);

  // Last applied values (dirty checking).
  let lx = NaN; let ly = NaN; let lCls = ''; let lRing = ''; let lRingOn = false;
  let lCap = ''; let lChip: string | null = null; let lCount = ''; let lPlaying: boolean | null = null; let lRate = '';
  let pool = 0;
  const flip: boolean[] = [false, false, false, false];

  return {
    host,
    root,
    apply(v: View, vp: Viewport) {
      const c = v.cursor;
      if (c.x !== lx || c.y !== ly) {
        cur.style.transform = `translate3d(${c.x}px,${c.y}px,0)`;
        lx = c.x; ly = c.y;
      }
      const cls = `cur${o.touch ? ' touch' : ''}${c.visible ? ' on' : ''}${c.pressed ? ' down' : ''}${c.x > vp.w - 220 ? ' left' : ''}${c.y > vp.h - 140 ? ' up' : ''}`;
      if (cls !== lCls) { cur.className = cls; lCls = cls; }

      if (v.ring) {
        const r = v.ring;
        const geo = `${r.x - 4},${r.y - 4},${r.w + 8},${r.h + 8}`;
        if (geo !== lRing) {
          ring.style.transform = `translate3d(${r.x - 4}px,${r.y - 4}px,0)`;
          ring.style.width = `${r.w + 8}px`;
          ring.style.height = `${r.h + 8}px`;
          lRing = geo;
        }
      }
      const ringOn = !!v.ring && c.visible;
      if (ringOn !== lRingOn) { ring.classList.toggle('on', ringOn); lRingOn = ringOn; }

      // A caption without a cursor ("Open /app to continue", "Sign in to start this guide.") has
      // nothing to hang a bubble on: it shows as the bar at the bottom instead.
      const text = o.captions === 'none' || !v.caption ? '' : v.caption.text;
      const asBar = o.captions === 'bar' || (!c.visible && !!text);
      const cap = `${v.caption?.key ?? ''}|${text}|${asBar}`;
      if (cap !== lCap) {
        live.textContent = text;
        live.className = asBar ? `bar${text ? ' on' : ''}` : 'sr';
        if (text && !asBar) bubble.textContent = text;
        bubble.classList.toggle('on', !!text && !asBar);
        lCap = cap;
      }

      const chipText = c.visible ? v.chip : null;
      if (chipText !== lChip) {
        if (chipText) chip.textContent = chipText;
        chip.classList.toggle('on', !!chipText);
        lChip = chipText;
      }

      if (counter) {
        const n = `${Math.min(v.index + 1, v.count)} / ${v.count}`;
        if (n !== lCount) { counter.textContent = n; lCount = n; }
      }
      if (playBtn) {
        const playing = v.phase === 'playing' || v.phase === 'waiting';
        if (playing !== lPlaying) {
          playBtn.textContent = playing ? '❚❚' : '▶';
          playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
          lPlaying = playing;
        }
      }
      if (rateBtn && o.rate) {
        const r = `${o.rate()}×`;
        if (r !== lRate) { rateBtn.textContent = r; lRate = r; }
      }
    },
    ripple(x: number, y: number) {
      const node = ripples[pool];
      flip[pool] = !flip[pool];
      node.style.setProperty('--p', `translate(${x}px,${y}px)`);
      node.className = `rip ${flip[pool] ? 'a' : 'b'}`;
      pool = (pool + 1) % ripples.length;
    },
    destroy() {
      host.remove();
    },
  };
}
