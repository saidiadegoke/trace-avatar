/**
 * trace-avatar/repair in each browser: what a stalled step could mean on the page now (never a field's value,
 * nothing hidden, masked, blurred or ignored), and a chosen element re-recorded so the player finds exactly it.
 */
import { test, expect } from '@playwright/test';

type R = {
  candidatesOf(root?: ParentNode, o?: { skip?: string; max?: number }): Array<{ id: number; role: string | null; name: string; text?: string; near?: string; key?: string }>;
  targetFor(id: number): Record<string, unknown> | null;
  resolvesTo(t: Record<string, unknown>, el: Element | null): boolean;
  elementOf(id: number): Element | null;
};

test.beforeEach(async ({ page }) => { await page.goto('/tests/e2e/fixtures/repair.html'); });

test('candidates: visible things to act on, named, with where they are; no values; nothing blurred, ignored or hidden; masked areas offered', async ({ page }) => {
  const list = await page.evaluate(() => (window as unknown as { TraceAvatarRepair: R }).TraceAvatarRepair.candidatesOf(document, { skip: '.dev' }));
  const names = list.map((c) => `${c.role ?? '-'}:${c.name}`);
  expect(names).toEqual([
    'link:Invoices', 'link:Customers',
    'textbox:Customer', 'textbox:Notes', 'textbox:Memo',
    'button:💾 Save invoice', 'button:Save draft', 'button:Preview',
    'textbox:Password', 'button:Masked action', 'button:Delete',
  ]);
  const json = JSON.stringify(list);
  for (const secret of ['hunter22', 'Grace Hopper', 'a private note', 'typed memo', 'Blurred action', 'Ignored action', 'Hidden save', 'Dev toolbar']) expect(json).not.toContain(secret);
  expect(list.find((c) => c.name === 'Invoices')).toMatchObject({ near: 'Menu' });
  expect(list.find((c) => c.name.includes('Save invoice'))).toMatchObject({ near: 'New invoice', key: 'save' });
  expect(list.find((c) => c.name === 'Save draft')).not.toHaveProperty('key');   // a generated id is no key
  expect(list.find((c) => c.name === 'Delete')).toMatchObject({ near: 'Confirm delete' });
  expect(list.map((c) => c.id)).toEqual(list.map((_, i) => i));
});

test('the chosen element re-recorded as a target is the one the player finds', async ({ page }) => {
  const out = await page.evaluate(() => {
    const r = (window as unknown as { TraceAvatarRepair: R }).TraceAvatarRepair;
    const list = r.candidatesOf();
    return list.map((c) => {
      const t = r.targetFor(c.id)!;
      return { name: c.name, target: t, ok: r.resolvesTo(t, r.elementOf(c.id)) };
    });
  });
  for (const x of out) expect(x.ok, x.name).toBe(true);
  expect(out.find((x) => x.name.includes('Save invoice'))!.target).toMatchObject({ sel: '[data-testid="save"]', role: 'button' });
  // A field's target never holds what is in it.
  expect(JSON.stringify(out.find((x) => x.name === 'Customer')!.target)).not.toContain('Grace');
  // Another element is not the one a target finds.
  const wrong = await page.evaluate(() => {
    const r = (window as unknown as { TraceAvatarRepair: R }).TraceAvatarRepair;
    r.candidatesOf();
    return r.resolvesTo(r.targetFor(5)!, r.elementOf(6));
  });
  expect(wrong).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { TraceAvatarRepair: R }).TraceAvatarRepair.targetFor(999))).toBeNull();
});
