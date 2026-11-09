// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, cdnLoaders, fromScript, guides, launcherOf, loadGlobal, mount } from '../../src/auto/cdn';

afterEach(() => {
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).TraceAvatar;
  delete (window as unknown as Record<string, unknown>).Thing;
  vi.restoreAllMocks();
});

/** A document whose script tags load only when the test says so (happy-dom won't run scripts). */
function fakeDoc() {
  const win: Record<string, unknown> = {};
  const added: Array<{ src: string; async: boolean; onload: () => void; onerror: () => void }> = [];
  const doc = {
    defaultView: win,
    head: { appendChild: (s: (typeof added)[number]) => { added.push(s); } },
    createElement: () => ({ src: '', async: false, onload: () => {}, onerror: () => {} }),
  } as unknown as Document;
  return {
    doc, win, added,
    finish(define?: () => void, ok = true) { const s = added[added.length - 1]; define?.(); if (ok) s.onload(); else s.onerror(); return s; },
  };
}

describe('launcherOf (data-launcher)', () => {
  it('on by default, bottom-left on request, off with off/false/none/no/0', () => {
    expect(launcherOf(null)).toBe('bottom-right');
    expect(launcherOf('')).toBe('bottom-right');
    expect(launcherOf('bottom-right')).toBe('bottom-right');
    expect(launcherOf(' Bottom-Left ')).toBe('bottom-left');
    expect(launcherOf('weird')).toBe('bottom-right');
    for (const v of ['off', 'false', 'none', 'no', '0', 'OFF']) expect(launcherOf(v)).toBe(false);
  });
});

describe('loadGlobal', () => {
  it('uses a global that is already there, without a script tag', async () => {
    (window as unknown as Record<string, unknown>).Thing = { ok: 1 };
    await expect(loadGlobal('/x.js', 'Thing', (g) => !!g)).resolves.toEqual({ ok: 1 });
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('adds the script, then resolves to its global; or says what went wrong', async () => {
    const f = fakeDoc();
    const p = loadGlobal<{ v: number }>('/lib.js', 'Thing', (g) => !!g, f.doc);
    const s = f.finish(() => { f.win.Thing = { v: 2 }; });
    expect([s.src, s.async]).toEqual(['/lib.js', true]);
    await expect(p).resolves.toEqual({ v: 2 });
    delete f.win.Thing;
    const missing = loadGlobal('/empty.js', 'Thing', (g) => !!g, f.doc);
    f.finish();
    await expect(missing).rejects.toThrow('/empty.js did not define Thing');
    const broken = loadGlobal('/404.js', 'Thing', (g) => !!g, f.doc);
    f.finish(undefined, false);
    await expect(broken).rejects.toThrow('could not load /404.js');
  });

  it('a document without a head appends to the root', async () => {
    const appended: unknown[] = [];
    const doc = { defaultView: {}, documentElement: { appendChild: (s: unknown) => appended.push(s) }, createElement: () => ({}) } as unknown as Document;
    void loadGlobal('/x.js', 'Thing', (g) => !!g, doc);
    expect(appended).toHaveLength(1);
  });
});

describe('cdnLoaders', () => {
  it('loads trace-perform.min.js from the same folder; trace.min.js’ TraceAvatar (no hands) is not enough', async () => {
    const f = fakeDoc();
    f.win.TraceAvatar = { createTrace() {} };
    const p = cdnLoaders('https://cdn.example/dist/', f.doc).player();
    const s = f.finish(() => { f.win.TraceAvatar = { createTrace() {}, createPerformer() {} }; });
    expect(s.src).toBe('https://cdn.example/dist/trace-perform.min.js');
    await expect(p).resolves.toHaveProperty('createPerformer');
    expect(BASE).toBe(''); // no script tag in tests
  });
});

describe('fromScript / mount', () => {
  it('nothing without data-guides; otherwise mounts from the attributes', async () => {
    expect(fromScript(null)).toBeNull();
    const s = document.createElement('script');
    expect(fromScript(s)).toBeNull();
    s.setAttribute('data-guides', '/guides.json');
    s.setAttribute('data-launcher', 'off');
    s.setAttribute('data-perform', 'true');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: 1, guides: [{ id: 'a', title: 'A', trace: 'a.json', modes: ['perform'] }] })));
    const g = fromScript(s)!;
    await g.ready;
    expect(g.modes('a')).toEqual(['perform']);
    expect(g.launcher!.host.shadowRoot!.querySelector('div')!.className).toBe('r hide');
    g.destroy();
    expect(guides).toBeNull(); // the module itself was not loaded from a script tag
  });

  it('mount() takes loaders to override', async () => {
    const player = vi.fn(async () => ({ createTrace: () => { throw new Error('x'); } }));
    const g = mount({ guides: { version: 1, guides: [{ id: 'a', title: 'A', trace: 'a.json' }] } }, { player });
    g.on('error', () => {});
    await g.play('a');
    expect(player).toHaveBeenCalled();
    g.destroy();
  });
});

describe('loaded from a script tag', () => {
  it('mounts from its attributes once the page is parsed, and finds the player beside itself', async () => {
    vi.resetModules();
    const s = document.createElement('script');
    s.src = 'https://cdn.example/npm/trace-avatar/dist/trace-auto.min.js?v=1';
    s.setAttribute('data-guides', '/guides.json');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: 1, guides: [] })));
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript');
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => s });
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    try {
      const mod = await import('../../src/auto/cdn');
      expect(mod.BASE).toBe('https://cdn.example/npm/trace-avatar/dist/');
      expect(mod.guides).toBeNull();
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect(mod.guides).not.toBeNull();
      await mod.guides!.ready;
      mod.guides!.destroy();
      // Already parsed: mounts at once.
      vi.resetModules();
      Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
      const again = await import('../../src/auto/cdn');
      expect(again.guides).not.toBeNull();
      again.guides!.destroy();
    } finally {
      delete (document as unknown as Record<string, unknown>).currentScript;
      delete (document as unknown as Record<string, unknown>).readyState;
      if (desc) Object.defineProperty(Document.prototype, 'currentScript', desc);
    }
  });
});
