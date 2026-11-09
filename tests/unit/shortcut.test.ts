import { describe, expect, it } from 'vitest';
import { matchShortcut } from '../../src/core/shortcut';

const k = (key: string, code: string | undefined, m: Partial<Record<'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) =>
  ({ key, code, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...m });

describe('matchShortcut', () => {
  it('matches letters by the physical key, with exactly the modifiers asked for', () => {
    expect(matchShortcut('Alt+Shift+R', k('®', 'KeyR', { altKey: true, shiftKey: true }), true)).toBe(true);
    expect(matchShortcut('Alt+Shift+R', k('R', 'KeyR', { altKey: true }), false)).toBe(false);
    expect(matchShortcut('Alt+Shift+R', k('R', 'KeyR', { altKey: true, shiftKey: true, ctrlKey: true }), false)).toBe(false);
    expect(matchShortcut('Alt+Shift+R', k('T', 'KeyT', { altKey: true, shiftKey: true }), false)).toBe(false);
    expect(matchShortcut('alt + shift + r', k('r', undefined, { altKey: true, shiftKey: true }), false)).toBe(true);
  });

  it('Mod is Cmd on a Mac and Ctrl elsewhere; digits and named keys', () => {
    expect(matchShortcut('Mod+K', k('k', 'KeyK', { metaKey: true }), true)).toBe(true);
    expect(matchShortcut('Mod+K', k('k', 'KeyK', { ctrlKey: true }), true)).toBe(false);
    expect(matchShortcut('Mod+K', k('k', 'KeyK', { ctrlKey: true }), false)).toBe(true);
    expect(matchShortcut('Ctrl+1', k('1', 'Digit1', { ctrlKey: true }), true)).toBe(true);
    expect(matchShortcut('Ctrl+1', k('!', undefined, { ctrlKey: true }), true)).toBe(false);
    expect(matchShortcut('Shift+F2', k('F2', 'F2', { shiftKey: true }), false)).toBe(true);
    expect(matchShortcut('Cmd+Option+Escape', k('Escape', 'Escape', { metaKey: true, altKey: true }), true)).toBe(true);
    expect(matchShortcut('', k('a', 'KeyA'), false)).toBe(false);
  });
});
