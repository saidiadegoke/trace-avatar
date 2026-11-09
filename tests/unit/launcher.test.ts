// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLauncher } from '../../src/shell/launcher.dom';
import type { LauncherItem, LauncherOptions } from '../../src/shell/launcher.dom';

let made: Array<{ destroy(): void }> = [];
afterEach(() => { made.forEach((l) => l.destroy()); made = []; document.body.innerHTML = ''; });

const ITEMS: LauncherItem[] = [
  { id: 'a', title: 'Create an invoice', modes: ['overlay', 'perform'] },
  { id: 'b', title: 'Send it', modes: ['overlay'] },
];
function make(o: Partial<LauncherOptions> = {}) {
  const calls = { play: [] as Array<[string, string]>, stop: 0 };
  const l = createLauncher({
    doc: document,
    position: 'bottom-right',
    items: () => ITEMS,
    onPlay: (id, mode) => calls.play.push([id, mode]),
    onStop: () => { calls.stop += 1; },
    ...o,
  });
  made.push(l);
  const root = l.host.shadowRoot!;
  const $ = (sel: string) => root.querySelector(sel) as HTMLElement;
  const buttons = () => Array.from(root.querySelectorAll('.menu button')).map((b) => b.textContent);
  return { l, root, $, buttons, calls };
}
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('createLauncher', () => {
  it('a corner button in its own shadow root, ignored by the recorder', () => {
    const { l, $ } = make();
    expect(l.host.parentElement).toBe(document.body);
    expect(l.host.getAttribute('data-trace-avatar')).toBe('launcher');
    expect($('.fab').getAttribute('aria-label')).toBe('Guides');
    expect($('div').className).toBe('r');
    const left = make({ position: 'bottom-left', hidden: true });
    expect(left.$('div').className).toBe('l hide');
  });

  it('opens a menu of this page’s guides, one button per mode; playing closes it', () => {
    const { l, $, buttons, calls, root } = make();
    expect(l.isOpen).toBe(false);
    $('.fab').click();
    expect(l.isOpen).toBe(true);
    expect($('.fab').getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(root.querySelectorAll('.t')).map((t) => t.textContent)).toEqual(['Create an invoice', 'Send it']);
    expect(buttons()).toEqual(['Show me', 'Do it for me', 'Show me']);
    expect(root.activeElement?.textContent).toBe('Show me');
    (root.querySelectorAll('.menu button')[1] as HTMLElement).click();
    expect(calls.play).toEqual([['a', 'perform']]);
    expect(l.isOpen).toBe(false);
  });

  it('says so when there are no guides; the list is read on every open', () => {
    let items: LauncherItem[] = [];
    const { l, $ } = make({ items: () => items });
    l.open();
    expect($('.empty').textContent).toBe('No guides for this page.');
    l.close();
    items = ITEMS;
    l.open();
    expect($('.empty')).toBeNull();
  });

  it('keyboard: arrows move through the buttons (wrapping), Esc closes and refocuses the button', () => {
    const { l, $, root } = make();
    l.open();
    const menu = $('.menu');
    key(menu, 'ArrowDown');
    expect(root.activeElement?.getAttribute('aria-label')).toBe('Do it for me: Create an invoice');
    key(menu, 'ArrowUp');
    key(menu, 'ArrowUp');
    expect(root.activeElement?.getAttribute('aria-label')).toBe('Show me: Send it');
    key(menu, 'Tab');
    expect(l.isOpen).toBe(true);
    key(menu, 'Escape');
    expect(l.isOpen).toBe(false);
    expect(root.activeElement).toBe($('.fab'));
  });

  it('a press outside closes it; inside does not; the button toggles', () => {
    const { l, $ } = make();
    l.open();
    $('.menu').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(l.isOpen).toBe(true);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(l.isOpen).toBe(false);
    $('.fab').click();
    $('.fab').click();
    expect(l.isOpen).toBe(false);
  });

  it('while a guide plays the button is "Stop guide"; it never opens the menu then', () => {
    const { l, $, calls } = make();
    l.open();
    l.setPlaying(true);
    expect(l.isOpen).toBe(false);
    expect($('.fab').textContent).toBe('■ Stop guide');
    expect($('.fab').hasAttribute('aria-haspopup')).toBe(false);
    expect($('div').classList.contains('playing')).toBe(true);
    l.open();
    expect(l.isOpen).toBe(false);
    $('.fab').click();
    expect(calls.stop).toBe(1);
    l.setPlaying(false);
    expect($('.fab').getAttribute('aria-label')).toBe('Guides');
    expect($('.fab').getAttribute('aria-haspopup')).toBe('menu');
  });

  it('Copy link per guide reports the result', async () => {
    const copy = vi.fn(async (id: string) => id === 'a');
    const { l, root, buttons } = make({ onCopy: copy });
    l.open();
    expect(buttons()).toEqual(['Show me', 'Do it for me', 'Copy link', 'Show me', 'Copy link']);
    const copies = Array.from(root.querySelectorAll('.menu button')).filter((b) => b.textContent === 'Copy link') as HTMLElement[];
    copies[0].click();
    copies[1].click();
    await Promise.resolve(); await Promise.resolve();
    expect(copy.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(copies.map((c) => c.textContent)).toEqual(['Copied', 'Copy failed']);
  });

  it('Record appears when offered, and can be turned on and off while open', () => {
    const rec = vi.fn();
    const { l, buttons, root } = make();
    l.open();
    expect(buttons()).not.toContain('● Record a guide');
    l.setRecord(rec);
    expect(buttons()).toContain('● Record a guide');
    (Array.from(root.querySelectorAll('.menu button')).find((b) => b.textContent === '● Record a guide') as HTMLElement).click();
    expect(rec).toHaveBeenCalledTimes(1);
    expect(l.isOpen).toBe(false);
    l.setRecord(undefined);
    l.open();
    expect(buttons()).not.toContain('● Record a guide');
    l.close();
    l.setRecord(rec); // closed: nothing to refresh
  });

  it('confirm asks before Do it for me: Start, Show me instead, Cancel, Esc; a second ask cancels the first', async () => {
    const { l, $, root } = make();
    const click = (text: string) => (Array.from(root.querySelectorAll('.dlg button')).find((b) => b.textContent === text) as HTMLElement).click();
    let p = l.confirm('Create an invoice');
    expect($('.dlg').hidden).toBe(false);
    expect($('.dlg h2').textContent).toBe('Do it for me: Create an invoice');
    expect(root.activeElement?.textContent).toBe('Start');
    click('Start');
    await expect(p).resolves.toBe('perform');
    expect($('.dlg').hidden).toBe(true);
    p = l.confirm('X');
    click('Show me instead');
    await expect(p).resolves.toBe('overlay');
    p = l.confirm('X');
    click('Cancel');
    await expect(p).resolves.toBeNull();
    p = l.confirm('X');
    key($('.dlg'), 'Escape');
    await expect(p).resolves.toBeNull();
    const first = l.confirm('one');
    const second = l.confirm('two');
    await expect(first).resolves.toBeNull();
    key($('.dlg'), 'Enter'); // not an answer
    click('Start');
    await expect(second).resolves.toBe('perform');
  });

  it('destroy removes it and settles an open question', async () => {
    const { l } = make();
    l.open();
    const p = l.confirm('X');
    l.destroy();
    await expect(p).resolves.toBeNull();
    expect(document.querySelector('[data-trace-avatar]')).toBeNull();
  });
});
