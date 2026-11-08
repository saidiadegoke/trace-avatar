/**
 * Contract: the published JSON Schema and the built-in validator agree.
 * Every fixture is checked by both; they must give the same verdict.
 */
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import schema from '../../schema/trace.v1.json';
import { validate } from '../../src/core/format';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const check = ajv.compile(schema);

const t = (steps: unknown[], extra: object = {}) => ({ version: 1, steps, ...extra });
const btn = { sel: '#b' };

const VALID = [
  t([{ type: 'click', target: btn }]),
  t([{ type: 'move', target: { role: 'button', name: 'Save' } }, { type: 'dblclick', target: { text: 'Row' } }]),
  t([{ type: 'type', target: btn, text: 'hi', mask: true, t: 10 }]),
  t([{ type: 'key', keys: 'Mod+Enter' }, { type: 'scroll', by: { y: 3 } }, { type: 'scroll', to: { x: 0 } }]),
  t([{ type: 'hover', target: { xy: { x: 1, y: 2 }, at: { rx: 0, ry: 1 } }, hold: 900 }, { type: 'wait', target: btn, timeout: 0 }]),
  t([{ type: 'note', say: 'hello', pause: true, highlight: false, duration: 5 }]),
  t([{ type: 'note', say: 'x' }], { meta: { title: 'T', viewport: { w: 10, h: 10 }, seed: 3, pointer: 'touch', truncated: true }, avatar: { name: 'A', image: '/a.png', color: 'red' } }),
  t([{ type: 'note', say: 'x' }], { path: [[0, 1, 2]] }),
  t([{ type: 'note', say: 'x' }], { path: [0, 1, 2] }),
  t([{ type: 'note', say: 'x' }], { path: null }),
  t([{ type: 'note', say: 'x' }], { avatar: { image: 'data:image/png;base64,AA' } }),
];

const INVALID = [
  { version: 2, steps: [{ type: 'note', say: 'x' }] },
  { steps: [{ type: 'note', say: 'x' }] },
  t([]),
  t([{ type: 'fly' }]),
  t([{ type: 'click' }]),
  t([{ type: 'click', target: {} }]),
  t([{ type: 'click', target: { name: 'Save' } }]),
  t([{ type: 'type', target: btn }]),
  t([{ type: 'key' }]),
  t([{ type: 'note' }]),
  t([{ type: 'note', say: '' }]),
  t([{ type: 'scroll' }]),
  t([{ type: 'note', say: 'x', t: -1 }]),
  t([{ type: 'note', say: 'x', pause: 'yes' }]),
  t([{ type: 'note', say: 'x'.repeat(501) }]),
  t([{ type: 'click', target: { sel: '#a', xy: { x: 1 } } }]),
  t([{ type: 'note', say: 'x' }], { avatar: { image: 'javascript:alert(1)' } }),
  t([{ type: 'note', say: 'x' }], { meta: { viewport: { w: 0, h: 1 } } }),
  t([{ type: 'note', say: 'x' }], { meta: { pointer: 'pen' } }),
  t([{ type: 'note', say: 'x' }], { path: [[0, 1]] }),
];

describe('schema contract', () => {
  it.each(VALID.map((v, i) => [i, v]))('valid fixture %i passes both', (_, fixture) => {
    expect(validate(fixture).errors).toEqual([]);
    expect(check(fixture), JSON.stringify(check.errors)).toBe(true);
  });

  it.each(INVALID.map((v, i) => [i, v]))('invalid fixture %i fails both', (_, fixture) => {
    expect(validate(fixture).ok).toBe(false);
    expect(check(fixture)).toBe(false);
  });

  it('the example traces in the repo are valid', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dirs = ['examples/vanilla-html', 'examples/react-demo', 'playground', 'tests/e2e/fixtures'];
    let n = 0;
    for (const d of dirs) {
      let files: string[] = [];
      try { files = readdirSync(d).filter((f) => f.endsWith('.trace.json')); } catch { continue; }
      for (const f of files) {
        const raw = JSON.parse(readFileSync(join(d, f), 'utf8'));
        expect(validate(raw).errors, `${d}/${f}`).toEqual([]);
        expect(check(raw), `${d}/${f}`).toBe(true);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
