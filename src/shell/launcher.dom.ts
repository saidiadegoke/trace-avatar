/**
 * The launcher: a corner button that lists the guides for this page ("Show me · Do it for me"),
 * becomes "Stop guide" while one plays, and asks before a link makes the guide act.
 *
 * Its own shadow root, keyboard accessible (a menu button: Enter/Space, arrows, Esc), themed with
 * the same --ta-* variables as the overlay. Marked data-trace-avatar so the recorder ignores it.
 */

import type { GuideMode } from '../core/manifest';

export type LauncherPosition = 'bottom-right' | 'bottom-left';

export interface LauncherItem { id: string; title: string; modes: readonly GuideMode[] }

export interface LauncherOptions {
  doc: Document;
  position: LauncherPosition;
  /** The guides for the page the viewer is on now (read each time the menu opens). */
  items: () => LauncherItem[];
  /** Hide the corner button (the app uses its own buttons); dialogs still work. */
  hidden?: boolean;
  onPlay(id: string, mode: GuideMode): void;
  onStop(): void;
  /** Offer "Copy link" per guide. Resolves true when copied. */
  onCopy?: (id: string) => Promise<boolean>;
  /** Offer "Record a guide". */
  onRecord?: () => void;
}

export type Consent = 'perform' | 'overlay' | null;

export interface Launcher {
  readonly host: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  setPlaying(playing: boolean): void;
  /** Ask before Do it for me runs from a link. */
  confirm(title: string): Promise<Consent>;
  /** Refresh whether Record is offered (it depends on the app's own check). */
  setRecord(onRecord: (() => void) | undefined): void;
  destroy(): void;
}

export const LAUNCHER_CSS = `
:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:var(--ta-z,2147483000);
--c:var(--ta-color,#2456d8);--bb:var(--ta-badge-bg,#111827);--bf:var(--ta-badge-fg,#f9fafb);--f:var(--ta-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
@media (prefers-color-scheme:dark){:host{--bb:var(--ta-badge-bg,#f9fafb);--bf:var(--ta-badge-fg,#111827)}}
button{all:unset;box-sizing:border-box;cursor:pointer;font:500 13px/1.2 var(--f)}
button:focus-visible{outline:2px solid var(--c);outline-offset:2px}
.fab{position:absolute;bottom:16px;width:44px;height:44px;border-radius:50%;background:var(--c);color:#fff;display:flex;align-items:center;justify-content:center;font:700 18px/1 var(--f);box-shadow:0 6px 18px rgb(0 0 0/.22);pointer-events:auto}
.r .fab{right:16px}.l .fab{left:16px}
.playing .fab{width:auto;padding:0 14px;border-radius:999px;font:600 13px/1 var(--f);bottom:64px}
.hide .fab{display:none}
.menu{position:absolute;bottom:70px;width:min(320px,calc(100vw - 32px));max-height:min(60vh,420px);overflow:auto;box-sizing:border-box;background:var(--bb);color:var(--bf);border-radius:14px;padding:8px;box-shadow:0 10px 30px rgb(0 0 0/.25);pointer-events:auto;font:13px/1.4 var(--f)}
.r .menu{right:16px}.l .menu{left:16px}
.menu[hidden],.dlg[hidden]{display:none}
.hd{font-weight:600;opacity:.7;padding:6px 8px 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.it{padding:8px;border-radius:10px}
.it+.it{border-top:1px solid color-mix(in srgb,var(--bf) 12%,transparent)}
.t{font-weight:600;margin-bottom:6px}
.row{display:flex;flex-wrap:wrap;gap:6px}
.row button,.ft button,.dlg .row button{padding:6px 10px;border-radius:999px;background:color-mix(in srgb,var(--bf) 12%,transparent)}
.row button:hover,.ft button:hover{background:color-mix(in srgb,var(--bf) 22%,transparent)}
.row .go{background:var(--c);color:#fff}
.empty{padding:10px 8px;opacity:.8}
.ft{padding:8px;border-top:1px solid color-mix(in srgb,var(--bf) 12%,transparent);margin-top:4px}
.dlg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(380px,calc(100vw - 32px));box-sizing:border-box;background:var(--bb);color:var(--bf);border-radius:14px;padding:18px;box-shadow:0 16px 40px rgb(0 0 0/.3);pointer-events:auto;font:14px/1.5 var(--f)}
.dlg h2{font:600 16px/1.3 var(--f);margin:0 0 6px}.dlg p{margin:0 0 14px;opacity:.85}
`;

export function createLauncher(o: LauncherOptions): Launcher {
  const doc = o.doc;
  const host = doc.createElement('div');
  host.setAttribute('data-trace-avatar', 'launcher');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = LAUNCHER_CSS;
  const wrap = doc.createElement('div');
  wrap.className = (o.position === 'bottom-left' ? 'l' : 'r') + (o.hidden ? ' hide' : '');
  root.append(style, wrap);

  const btn = (text: string, cls = '', label?: string) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (cls) b.className = cls;
    if (label) b.setAttribute('aria-label', label);
    return b;
  };

  const fab = btn('?', 'fab', 'Guides');
  fab.setAttribute('aria-haspopup', 'menu');
  fab.setAttribute('aria-expanded', 'false');
  const menu = doc.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Guides');
  menu.hidden = true;
  const dlg = doc.createElement('div');
  dlg.className = 'dlg';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.hidden = true;
  wrap.append(fab, menu, dlg);

  let playing = false;
  let onRecord = o.onRecord;

  const menuButtons = () => Array.from(menu.querySelectorAll('button'));
  const fill = () => {
    menu.textContent = '';
    const hd = doc.createElement('div');
    hd.className = 'hd';
    hd.textContent = 'Guides';
    menu.append(hd);
    const items = o.items();
    if (!items.length) {
      const e = doc.createElement('div');
      e.className = 'empty';
      e.textContent = 'No guides for this page.';
      menu.append(e);
    }
    for (const it of items) {
      const box = doc.createElement('div');
      box.className = 'it';
      const t = doc.createElement('div');
      t.className = 't';
      t.textContent = it.title;
      const row = doc.createElement('div');
      row.className = 'row';
      for (const mode of it.modes) {
        const b = btn(mode === 'perform' ? 'Do it for me' : 'Show me', 'go', `${mode === 'perform' ? 'Do it for me' : 'Show me'}: ${it.title}`);
        b.setAttribute('role', 'menuitem');
        b.addEventListener('click', () => { close(); o.onPlay(it.id, mode); });
        row.append(b);
      }
      if (o.onCopy) {
        const c = btn('Copy link', '', `Copy link: ${it.title}`);
        c.setAttribute('role', 'menuitem');
        c.addEventListener('click', () => {
          void o.onCopy!(it.id).then((ok) => { c.textContent = ok ? 'Copied' : 'Copy failed'; });
        });
        row.append(c);
      }
      box.append(t, row);
      menu.append(box);
    }
    if (onRecord) {
      const ft = doc.createElement('div');
      ft.className = 'ft';
      const r = btn('● Record a guide');
      r.setAttribute('role', 'menuitem');
      const go = onRecord;
      r.addEventListener('click', () => { close(); go(); });
      ft.append(r);
      menu.append(ft);
    }
  };

  const outside = (e: Event) => { if (!e.composedPath().includes(host)) close(); };
  function open() {
    if (playing || !menu.hidden) return;
    fill();
    menu.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    doc.addEventListener('pointerdown', outside, true);
    menuButtons()[0]?.focus();
  }
  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', outside, true);
  }

  fab.addEventListener('click', () => {
    if (playing) { o.onStop(); return; }
    if (menu.hidden) open(); else close();
  });
  menu.addEventListener('keydown', (e) => {
    const list = menuButtons();
    const k = list.indexOf(root.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); fab.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.length;
      list[(k + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n]?.focus();
    }
  });

  let answer: ((c: Consent) => void) | null = null;
  const settle = (c: Consent) => {
    dlg.hidden = true;
    dlg.textContent = '';
    const a = answer;
    answer = null;
    a?.(c);
  };
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); settle(null); } });

  (doc.body ?? doc.documentElement).appendChild(host);

  return {
    host,
    get isOpen() { return !menu.hidden; },
    open,
    close,
    setPlaying(p) {
      playing = p;
      if (p) close();
      wrap.classList.toggle('playing', p);
      fab.textContent = p ? '■ Stop guide' : '?';
      fab.setAttribute('aria-label', p ? 'Stop guide' : 'Guides');
      if (p) fab.removeAttribute('aria-haspopup'); else fab.setAttribute('aria-haspopup', 'menu');
    },
    confirm(title) {
      settle(null);
      return new Promise<Consent>((resolve) => {
        answer = resolve;
        dlg.textContent = '';
        const h = doc.createElement('h2');
        h.id = 'ta-dlg-h';
        h.textContent = `Do it for me: ${title}`;
        const p = doc.createElement('p');
        p.textContent = 'The guide will click and type in this app for you. You can stop it at any time.';
        const row = doc.createElement('div');
        row.className = 'row';
        const start = btn('Start', 'go');
        const show = btn('Show me instead');
        const cancel = btn('Cancel');
        start.addEventListener('click', () => settle('perform'));
        show.addEventListener('click', () => settle('overlay'));
        cancel.addEventListener('click', () => settle(null));
        row.append(start, show, cancel);
        dlg.setAttribute('aria-labelledby', 'ta-dlg-h');
        dlg.append(h, p, row);
        dlg.hidden = false;
        start.focus();
      });
    },
    setRecord(fn) { onRecord = fn; if (!menu.hidden) fill(); },
    destroy() {
      close();
      settle(null);
      host.remove();
    },
  };
}
