import { describe, expect, it } from 'vitest';
import { PENDING_MS, makeLink, pendingOk, readLink } from '../../src/core/links';

describe('readLink', () => {
  it('reads ?trace=id and ?trace-mode, and gives the URL without them (other parameters kept)', () => {
    expect(readLink('https://app.example/app?x=1&trace=create-invoice&trace-mode=perform#top')).toEqual({
      id: 'create-invoice', raw: 'create-invoice', mode: 'perform', cleaned: 'https://app.example/app?x=1#top',
    });
    expect(readLink('https://app.example/app?trace=a')).toMatchObject({ id: 'a', mode: 'overlay', cleaned: 'https://app.example/app' });
    expect(readLink('https://app.example/app?trace=a&trace-mode=weird')!.mode).toBe('overlay');
  });

  it('reads #trace=id for servers that drop unknown parameters, keeping the rest of the hash', () => {
    expect(readLink('https://app.example/app#trace=a&trace-mode=perform')).toMatchObject({ id: 'a', mode: 'perform', cleaned: 'https://app.example/app' });
    expect(readLink('https://app.example/app#tab=2&trace=a')).toMatchObject({ id: 'a', cleaned: 'https://app.example/app#tab=2' });
    expect(readLink('https://app.example/app#section')).toBeNull();
  });

  it('never accepts a trace URL or anything that is not a guide id', () => {
    const r = readLink('https://app.example/?trace=https%3A%2F%2Fevil.example%2Ft.json');
    expect(r).toMatchObject({ id: null, raw: 'https://evil.example/t.json', cleaned: 'https://app.example/' });
    expect(readLink('https://app.example/?trace=')!.id).toBeNull();
  });

  it('no link: null; another parameter name', () => {
    expect(readLink('https://app.example/app?x=1')).toBeNull();
    expect(readLink('https://app.example/app?guide=a&guide-mode=perform', 'guide')).toMatchObject({ id: 'a', mode: 'perform', cleaned: 'https://app.example/app' });
  });
});

describe('makeLink', () => {
  it('builds Show me and Do it for me links, keeping the page’s own query', () => {
    expect(makeLink('https://app.example', '/app/invoices', 'create-invoice')).toBe('https://app.example/app/invoices?trace=create-invoice');
    expect(makeLink('https://app.example', '/app?tab=2', 'a', 'perform')).toBe('https://app.example/app?tab=2&trace=a&trace-mode=perform');
    expect(makeLink('https://app.example', '/app?trace-mode=perform', 'a', 'overlay', 'trace')).toBe('https://app.example/app?trace=a');
    expect(makeLink('https://app.example', '/', 'a', 'overlay', 'guide')).toBe('https://app.example/?guide=a');
  });

  it('round-trips through readLink', () => {
    const url = makeLink('https://app.example', '/x', 'g_1', 'perform');
    expect(readLink(url)).toMatchObject({ id: 'g_1', mode: 'perform', cleaned: 'https://app.example/x' });
  });
});

describe('pendingOk', () => {
  it('fresh, well-formed pending guides only', () => {
    const now = 1_000_000;
    expect(pendingOk({ id: 'a', mode: 'overlay', at: now }, now)).toBe(true);
    expect(pendingOk({ id: 'a', mode: 'perform', at: now - PENDING_MS + 1, agreed: true }, now)).toBe(true);
    expect(pendingOk({ id: 'a', mode: 'overlay', at: now - PENDING_MS }, now)).toBe(false);
    expect(pendingOk({ id: 'a', mode: 'overlay', at: now + 5 }, now)).toBe(false);
    expect(pendingOk({ id: 'a b', mode: 'overlay', at: now }, now)).toBe(false);
    expect(pendingOk({ id: 'a', mode: 'x', at: now }, now)).toBe(false);
    expect(pendingOk({ id: 'a', mode: 'overlay' }, now)).toBe(false);
    expect(pendingOk(null, now)).toBe(false);
    expect(pendingOk('a', now)).toBe(false);
  });
});
