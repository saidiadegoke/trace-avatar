import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The loader (trace-auto.min.js) as an app adds it: one script tag and a guides manifest.
const APP = '/tests/e2e/fixtures/guides/app.html';
const launcher = (page: Page) => page.locator('[data-trace-avatar=launcher]');
const fab = (page: Page) => launcher(page).locator('.fab');
const menuButtons = (page: Page) => launcher(page).locator('.menu button');
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
