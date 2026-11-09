import { expect, test } from '@playwright/test';

// The assembled GitHub Pages site (npm run site), served from /_site/ as Pages serves it from /trace-avatar/.
test('the Pages site: root redirects to the playground, which plays its sample', async ({ page }) => {
  await page.goto('/_site/');
  await expect(page).toHaveURL(/\/_site\/playground\/$/);
  await expect(page.locator('#json')).toHaveValue(/Create your first invoice/);
  await page.click('#play');
  await expect.poll(() => page.evaluate(() => (window as any).pg.steps.length), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('the Pages site: the example and the schema are published', async ({ page, request }) => {
  await page.goto('/_site/examples/guides-html/');
  await expect(page.locator('[data-trace-avatar=launcher]').locator('.fab')).toBeVisible();
  await page.goto('/_site/examples/vanilla-html/');
  await expect(page.locator('[data-trace-avatar]').locator('.bubble')).toHaveText(/Let’s create an invoice/);
  const schema = await request.get('/_site/schema/trace.v1.json');
  expect(schema.ok()).toBe(true);
  expect((await schema.json()).title).toMatch(/trace-avatar/);
});
