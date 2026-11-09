// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveVideoWith, ExportError } from '../../src/export/export.dom';
import type { TraceController } from '../../src/index';

const ctl = () => ({ ready: Promise.resolve(), stop: vi.fn(), pause: vi.fn(), play: vi.fn(), on: vi.fn(() => () => {}), trace: { meta: { title: 'x' }, avatar: { color: '#f0a' } } }) as unknown as TraceController & { stop: ReturnType<typeof vi.fn> };
const gifLoader = () => ({ gif: vi.fn(async () => ({ startGif: vi.fn() })) });
const setMedia = (v: unknown) => Object.defineProperty(navigator, 'mediaDevices', { value: v, configurable: true });

afterEach(() => { setMedia(undefined); vi.unstubAllGlobals(); });

describe('saveVideo: before recording', () => {
  it('no getDisplayMedia: unsupported, nothing touched', async () => {
    setMedia(undefined);
    const c = ctl();
    const e = await saveVideoWith(c, {}, gifLoader()).catch((x) => x);
    expect(e).toBeInstanceOf(ExportError);
    expect(e.reason).toBe('unsupported');
    expect(c.stop).not.toHaveBeenCalled();
  });

  it('video without MediaRecorder (or no type it records): unsupported, with the GIF suggested', async () => {
    setMedia({ getDisplayMedia: vi.fn() });
    vi.stubGlobal('MediaRecorder', undefined);
    const e = await saveVideoWith(ctl(), { format: 'video' }, gifLoader()).catch((x) => x);
    expect(e.reason).toBe('unsupported');
    expect(e.message).toContain('GIF');
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false });
    expect((await saveVideoWith(ctl(), { format: 'video' }, gifLoader()).catch((x) => x)).reason).toBe('unsupported');
  });

  it('the encoder loads before the viewer is asked; a refusal is "denied"; the guide goes back to the start', async () => {
    const order: string[] = [];
    const ask = vi.fn(async () => { order.push('ask'); throw new DOMException('no', 'NotAllowedError'); });
    setMedia({ getDisplayMedia: ask });
    const loaders = { gif: vi.fn(async () => { order.push('gif'); return { startGif: vi.fn() }; }) };
    const c = ctl();
    const e = await saveVideoWith(c, {}, loaders).catch((x) => x);
    expect(e.reason).toBe('denied');
    expect(order).toEqual(['gif', 'ask']);
    expect(c.stop).toHaveBeenCalled();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ preferCurrentTab: true, audio: false }));
  });

  it('an encoder that fails to load fails before asking; an already aborted signal cancels', async () => {
    const ask = vi.fn();
    setMedia({ getDisplayMedia: ask });
    const e = await saveVideoWith(ctl(), {}, { gif: async () => { throw new Error('could not load trace-gif.min.js'); } }).catch((x) => x);
    expect(e).toMatchObject({ reason: 'failed', message: 'the GIF encoder could not load: could not load trace-gif.min.js' });
    expect(ask).not.toHaveBeenCalled();
    const ac = new AbortController();
    ac.abort();
    expect((await saveVideoWith(ctl(), { signal: ac.signal }, gifLoader()).catch((x) => x)).reason).toBe('cancelled');
  });
});
