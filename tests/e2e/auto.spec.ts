import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The loader (trace-auto.min.js) as an app adds it: one script tag and a guides manifest.
const APP = '/tests/e2e/fixtures/guides/app.html';
const launcher = (page: Page) => page.locator('[data-trace-avatar=launcher]');
const fab = (page: Page) => launcher(page).locator('.fab');
const menuButtons = (page: Page) => launcher(page).locator('.menu .go');
const overlay = (page: Page) => page.locator('[data-trace-avatar]:not([data-trace-avatar=launcher])');
const ready = (page: Page) => page.waitForFunction(() => (window as any).TraceAvatarAuto?.guides?.manifest);

test('lists this page’s guides; the player is fetched only on the first play; Show me leaves the page alone', async ({ page }) => {
  const players: string[] = [];
  page.on('request', (r) => { if (r.url().includes('trace-perform')) players.push(r.url()); });
  await page.goto(APP);
  await ready(page);
  await expect(fab(page)).toHaveAttribute('aria-label', 'Guides');
  await fab(page).click();
  await expect(launcher(page).locator('.t')).toHaveText(['Create an invoice', 'Finish on the next page']);
  await expect(menuButtons(page)).toHaveText(['Show me', 'Do it for me', 'Do it for me']);
  expect(players).toEqual([]);
  await menuButtons(page).first().click();
  await expect(fab(page)).toHaveText('■ Stop guide');
  await expect(overlay(page).locator('.bubble')).toHaveText('Send it.', { timeout: 15_000 });
  expect(players).toHaveLength(1);
  await expect(page.locator('#customer')).toHaveValue('');
  await expect(fab(page)).toHaveText('?', { timeout: 10_000 }); // ended: the launcher is back
  await expect(overlay(page)).toHaveCount(0);
});

test('Do it for me from the launcher fills and sends the form', async ({ page }) => {
  await page.goto(APP);
  await ready(page);
  await fab(page).click();
  await menuButtons(page).nth(1).click();
  await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores for 125000', { timeout: 15_000 });
});

test('without data-perform the launcher offers Show me only, and a Do it for me button is refused', async ({ page }) => {
  await page.goto(`${APP}?perform=false`);
  await ready(page);
  await fab(page).click();
  await expect(launcher(page).locator('.t')).toHaveText(['Create an invoice']);
  await expect(menuButtons(page)).toHaveText(['Show me']);
  await page.keyboard.press('Escape');
  const warnings: string[] = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.click('#own-do');
  await expect.poll(() => warnings.length).toBeGreaterThan(0);
  expect(warnings[0]).toContain('can\'t be played as Do it for me here');
  await expect(overlay(page)).toHaveCount(0);
});

test('data-launcher="off": no corner button, the app’s own data-trace-guide buttons play', async ({ page }) => {
  await page.goto(`${APP}?launcher=off`);
  await ready(page);
  await expect(fab(page)).toBeHidden();
  await page.click('#own');
  await expect(overlay(page).locator('.bubble')).toHaveText('Pick the customer.', { timeout: 10_000 });
});

test('Stop guide stops it', async ({ page }) => {
  await page.goto(APP);
  await ready(page);
  await page.click('#own');
  await expect(overlay(page)).toHaveCount(1);
  await fab(page).click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(fab(page)).toHaveText('?');
});

test('a guide carries on after a full page load', async ({ page }) => {
  await page.goto(APP);
  await ready(page);
  await fab(page).click();
  await launcher(page).getByRole('menuitem', { name: 'Do it for me: Finish on the next page' }).click();
  await expect(page).toHaveURL(/page2\.html$/, { timeout: 15_000 });
  await expect(page.locator('#done')).toHaveText('Finished', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('trace-avatar:auto:active'))).toBeNull();
});

test.describe('links', () => {
  test('?trace=id plays Show me and leaves the address clean', async ({ page }) => {
    await page.goto(`${APP}?trace=invoice`);
    await expect(overlay(page).locator('.bubble')).toHaveText('Pick the customer.', { timeout: 10_000 });
    expect(new URL(page.url()).search).toBe('');
    await expect(page.locator('#customer')).toHaveValue('');
  });

  test('a Do it for me link asks first; Start runs it', async ({ page }) => {
    await page.goto(`${APP}?trace=invoice&trace-mode=perform`);
    const dlg = launcher(page).locator('.dlg');
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    await expect(dlg.locator('h2')).toHaveText('Do it for me: Create an invoice');
    await expect(page.locator('#customer')).toHaveValue(''); // nothing happened before the click
    await dlg.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores for 125000', { timeout: 15_000 });
  });

  test('a link to an app that needs sign-in waits through the sign-in and its reload', async ({ page }) => {
    await page.goto('/tests/e2e/fixtures/guides/signin.html#trace=invoice&trace-mode=perform');
    const dlg = launcher(page).locator('.dlg');
    await dlg.getByRole('button', { name: 'Start' }).click();
    await expect(overlay(page).locator('.bar')).toHaveText('Sign in to start this guide.', { timeout: 10_000 });
    await page.click('#signin'); // a full reload, without the link in the address
    await expect(page.locator('#who')).toHaveText('Signed in');
    await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores', { timeout: 15_000 });
    await expect(dlg).toBeHidden(); // agreed once, not asked again
    expect(await page.evaluate(() => sessionStorage.getItem('trace-avatar:auto:pending'))).toBeNull();
  });

  test('a link carrying a trace URL is refused', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(`${APP}?trace=${encodeURIComponent('https://evil.example/fake.trace.json')}`);
    await expect.poll(() => warnings.join('\n')).toContain('is not a guide id');
    await expect(overlay(page)).toHaveCount(0);
  });

  test('Copy link copies a link that plays the guide here', async ({ page, context }) => {
    await page.addInitScript(() => {
      (window as any).copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { (window as any).copied.push(t); } } });
    });
    await page.goto(APP);
    await ready(page);
    await fab(page).click();
    await launcher(page).getByRole('menuitem', { name: 'Copy link: Create an invoice' }).click();
    await expect(launcher(page).getByRole('menuitem', { name: 'Copy link: Create an invoice' })).toHaveText('Copied');
    const [url] = await page.evaluate(() => (window as any).copied);
    expect(url).toMatch(/\/tests\/e2e\/fixtures\/guides\/app\.html\?trace=invoice$/);
    const other = await context.newPage();
    await other.goto(url);
    await expect(other.locator('[data-trace-avatar]:not([data-trace-avatar=launcher])').locator('.bubble')).toHaveText('Pick the customer.', { timeout: 10_000 });
  });
});
