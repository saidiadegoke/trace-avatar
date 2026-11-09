import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import schema from '../../schema/guides.v1.json';
import { MANIFEST_LIMITS, findGuide, guidesOn, modesOf, parseManifest, validateManifest } from '../../src/core/manifest';
import type { NManifest } from '../../src/core/manifest';

const g = (o: object = {}) => ({ id: 'create-invoice', title: 'Create an invoice', trace: 'a.trace.json', ...o });
const m = (guides: unknown[]) => ({ version: 1, guides });

describe('validateManifest', () => {
  it('accepts a minimal and a full manifest', () => {
    expect(validateManifest(m([])).ok).toBe(true);
    expect(validateManifest(m([g(), g({ id: 'b', trace: { version: 1, steps: [] }, modes: ['overlay', 'perform'], pages: ['/app/*'], tags: ['x'] })])).errors).toEqual([]);
  });

  it('reports every problem with its path', () => {
    expect(validateManifest(null).errors).toEqual([{ path: '', message: 'a manifest is an object' }]);
    expect(validateManifest({ version: 2 }).errors.map((e) => e.path)).toEqual(['version', 'guides']);
    const bad = validateManifest(m([
      'x',
      g({ id: '-bad', title: '  ', trace: '' }),
      g({ modes: [] }),
      g({ id: 'c', modes: ['fly', 'overlay', 'overlay'] }),
      g({ id: 'd', pages: ['app', 3], tags: 'x' }),
      g({ id: 'd' }),
      g({ id: 'e', pages: Array(MANIFEST_LIMITS.pages + 1).fill('/a') }),
    ]));
    expect(bad.errors.map((e) => e.path)).toEqual([
      'guides[0]', 'guides[1].id', 'guides[1].title', 'guides[1].trace', 'guides[2].modes',
      'guides[3].modes[0]', 'guides[3].modes', 'guides[4].pages[0]', 'guides[4].pages[1]', 'guides[4].tags', 'guides[5].id', 'guides[6].pages',
    ]);
    expect(bad.errors.find((e) => e.path === 'guides[5].id')?.message).toBe('"d" is used twice');
    expect(validateManifest(m(Array(MANIFEST_LIMITS.guides + 1).fill(0).map((_, k) => g({ id: `g${k}` })))).errors[0].path).toBe('guides');
  });
});

describe('parseManifest', () => {
  it('fills defaults and copies lists', () => {
    const raw = m([g({ title: ' Spaced ' }), g({ id: 'b', modes: ['perform'], pages: ['/x'], tags: ['t'] })]);
    const r = parseManifest(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.guides[0]).toEqual({ id: 'create-invoice', title: 'Spaced', trace: 'a.trace.json', modes: ['overlay'], pages: [], tags: [] });
    expect(r.manifest.guides[1]).toMatchObject({ modes: ['perform'], pages: ['/x'], tags: ['t'] });
    (raw.guides[1] as { modes: string[] }).modes.push('overlay');
    expect(r.manifest.guides[1].modes).toEqual(['perform']);
  });

  it('returns the errors for a bad one', () => {
    expect(parseManifest(m([{}]))).toMatchObject({ ok: false });
  });
});

describe('guidesOn / modesOf / findGuide', () => {
  const r = parseManifest(m([
    g({ id: 'everywhere' }),
    g({ id: 'tasks', pages: ['/app/tasks/*', '/app'] }),
    g({ id: 'both', modes: ['perform', 'overlay'] }),
    g({ id: 'do', modes: ['perform'] }),
  ]));
  const man = (r as { manifest: NManifest }).manifest;

  it('lists guides by page; every guide when the page is unknown', () => {
    expect(guidesOn(man, '/app/tasks/123').map((x) => x.id)).toEqual(['everywhere', 'tasks', 'both', 'do']);
    expect(guidesOn(man, '/settings').map((x) => x.id)).toEqual(['everywhere', 'both', 'do']);
    expect(guidesOn(man).length).toBe(4);
  });

  it('Do it for me only when the app allows it too; order kept', () => {
    expect(modesOf(findGuide(man, 'both')!, true)).toEqual(['perform', 'overlay']);
    expect(modesOf(findGuide(man, 'both')!, false)).toEqual(['overlay']);
    expect(modesOf(findGuide(man, 'do')!, false)).toEqual([]);
    expect(findGuide(man, 'nope')).toBeUndefined();
  });
});

describe('the published schema agrees with the validator', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const check = ajv.compile(schema);
  const VALID = [m([]), m([g()]), m([g({ trace: { version: 1 }, modes: ['perform'], pages: ['/'], tags: ['a'] })])];
  // Unique ids across guides can't be said in JSON Schema; that one is the validator's alone.
  const INVALID = [
    {}, m('x' as unknown as unknown[]), { version: 2, guides: [] }, m([g({ id: '' })]), m([g({ id: 'a b' })]), m([g({ title: '' })]),
    m([g({ title: '   ' })]), m([g({ trace: '' })]), m([g({ trace: 3 })]), m([g({ modes: [] })]), m([g({ modes: ['x'] })]),
    m([g({ modes: ['overlay', 'overlay'] })]), m([g({ pages: ['x'] })]), m([g({ tags: [''] })]),
  ];
  it.each(VALID.map((v, k) => [k, v]))('valid %i', (_k, v) => {
    expect(check(v)).toBe(true);
    expect(validateManifest(v).ok).toBe(true);
  });
  it.each(INVALID.map((v, k) => [k, v]))('invalid %i', (_k, v) => {
    expect(check(v)).toBe(false);
    expect(validateManifest(v).ok).toBe(false);
  });
});
