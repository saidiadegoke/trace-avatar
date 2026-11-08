import { expect, test } from '@playwright/test';

test('vanilla example plays its demo trace with controls', async ({ page }) => {
  await page.goto('/examples/vanilla-html/');
  const host = page.locator('[data-trace-avatar]');
  await expect(host.locator('button[aria-label="Pause"]')).toBeVisible();
  await expect(host.locator('.bubble')).toHaveText(/Let’s create an invoice/);
  await expect(host.locator('.n')).toHaveText(/^[1-8] \/ 8$/);
});

test('playground: checks JSON, reports errors, plays an edited trace', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.locator('#json')).toHaveValue(/Create your first invoice/);
  await page.fill('#json', '{ not json');
  await page.click('#check');
  await expect(page.locator('#status')).toHaveText(/Not valid JSON/);
  await page.fill('#json', JSON.stringify({ version: 1, steps: [{ type: 'click' }] }));
  await page.click('#check');
  await expect(page.locator('#status')).toHaveText('steps[0].target: a click step needs a target');
  await page.fill('#json', JSON.stringify({ version: 1, steps: [{ type: 'click', target: { role: 'button', name: 'Send invoice' }, t: 200 }] }));
  await page.click('#check');
  await expect(page.locator('#status')).toHaveText('Looks good.');
  await page.click('#play');
  await expect.poll(() => page.evaluate(() => (window as any).pg.steps)).toEqual([0]);
  await expect(page.locator('#status')).toHaveText(/Finished|found by role/);
  await page.click('#reset');
  await expect(page.locator('#json')).toHaveValue(/Create your first invoice/);
});

test('the README quick start works as written', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const readme = readFileSync('README.md', 'utf8');
  const snippet = /```html\n([\s\S]*?)```/.exec(readme)![1]
    .replace('https://cdn.jsdelivr.net/npm/trace-avatar/dist/trace.min.js', '/dist/trace.min.js');
  await page.goto('/tests/e2e/fixtures/blank.html');
  await page.setContent(`<!doctype html><html><body>
    <button>New invoice</button><label>Customer <input></label><button>Send invoice</button>
    ${snippet}</body></html>`);
  const host = page.locator('[data-trace-avatar]');
  await expect(host.locator('.bubble')).toHaveText('Start from New invoice.');
  await expect(host.locator('.chip')).toHaveText('Ada Stores', { timeout: 8000 });
  await expect(host.locator('.bubble')).toHaveText('Send it — done.', { timeout: 8000 });
});
