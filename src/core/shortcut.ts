/**
 * Keyboard shortcuts written as text: "Alt+Shift+R", "Mod+Shift+K" (Mod = ⌘ on a Mac, Ctrl elsewhere).
 * Letters and digits match by the physical key (e.code), so Alt+R still matches on a Mac, where
 * Option changes the character typed. PURE.
 */

export interface KeyLike { key: string; code?: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

export function matchShortcut(spec: string, e: KeyLike, mac: boolean): boolean {
  const parts = spec.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const want = {
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
    ctrl: mods.has('ctrl') || mods.has('control') || (mods.has('mod') && !mac),
    meta: mods.has('meta') || mods.has('cmd') || (mods.has('mod') && mac),
  };
  if (e.altKey !== want.alt || e.shiftKey !== want.shift || e.ctrlKey !== want.ctrl || e.metaKey !== want.meta) return false;
  if (/^[a-z]$/i.test(key)) return e.code ? e.code === `Key${key.toUpperCase()}` : e.key.toLowerCase() === key.toLowerCase();
  if (/^[0-9]$/.test(key)) return e.code ? e.code === `Digit${key}` : e.key === key;
  return e.key.toLowerCase() === key.toLowerCase();
}
