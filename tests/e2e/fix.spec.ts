import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// "Fix this step": a guide meets an app that renamed a button; the author fixes it where it stalled.
const APP = '/tests/e2e/fixtures/fix/app.html';
const card = (page: Page) => page.locator('[data-trace-avatar=fix]').locator('.card');
const msg = (page: Page) => card(page).locator('.msg');
const bubble = (page: Page) => page.locator('[data-trace-avatar]:not([data-trace-avatar=fix]):not([data-trace-avatar=launcher])').locator('.bubble');
const ready = (page: Page) => page.waitForFunction(() => (window as any).guides?.manifest);
const clicks = (page: Page) => page.evaluate(() => (window as any).clicks);
const start = async (page: Page, q = '', mode = 'overlay') => {
  const chunks: string[] = [];
  page.on('request', (r) => { if (r.url().includes('trace-fix')) chunks.push(r.url()); });
  await page.goto(APP + q);
  await ready(page);
  await page.evaluate((m) => (window as any).guides.play('invoice', { mode: m }), mode);
  return chunks;
};

test('an author is offered a fix; Yes on the guess fixes the step, the guide finishes, and Save hands over the fixed guide', async ({ page }) => {
  const chunks = await start(page);
  await expect(msg(page)).toHaveText('Step 2 can’t find button “Save invoice”.', { timeout: 15_000 });
  expect(chunks).toHaveLength(1);
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await expect(msg(page)).toHaveText('Is it this? (button “Store invoice”)');
  await card(page).getByRole('button', { name: 'Yes' }).click();
  await expect(msg(page)).toHaveText('Fixed step 2: button “Store invoice”.');
  await expect(bubble(page)).toHaveText('All done.', { timeout: 15_000 });
  expect((await clicks(page)).store).toBe(0); // Show me never clicks
  await card(page).getByRole('button', { name: 'Save the guide' }).click();
  await expect(msg(page)).toHaveText('Saved: step 2 is fixed for everyone.');
  const saved = await page.evaluate(() => (window as any).saved);
  expect(saved).toHaveLength(1);
  expect(saved[0].entry).toMatchObject({ id: 'invoice', title: 'Make an invoice' });
  expect(saved[0].trace.steps[1]).toMatchObject({ type: 'click', say: 'Save it.', target: { role: 'button', name: 'Store invoice' } });
  expect(saved[0].trace.steps[0]).toMatchObject({ target: { sel: '#new' } });
  expect(JSON.stringify(saved)).not.toContain('hunter22');
  // Played again this session: the fixed guide, no stall.
  await card(page).getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => (window as any).guides.play('invoice'));
  await expect(bubble(page)).toHaveText('All done.', { timeout: 15_000 });
  await expect(card(page)).toHaveCount(0);
});

test('Do it for me carries on with the fixed step and clicks the renamed button', async ({ page }) => {
  await start(page, '', 'perform');
  await expect(msg(page)).toHaveText(/Step 2 can’t find/, { timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await card(page).getByRole('button', { name: 'Yes' }).click();
  await expect.poll(async () => (await clicks(page)).store, { timeout: 15_000 }).toBe(1);
  await card(page).getByRole('button', { name: 'Just this time' }).click();
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).saved)).toEqual([]);
});

test('pointing: the click picks the element and never reaches the app; Esc cancels first', async ({ page }) => {
  await start(page);
  await expect(msg(page)).toHaveText(/Step 2 can’t find/, { timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await card(page).getByRole('button', { name: 'No, I’ll point at it' }).click();
  await expect(msg(page)).toHaveText('Click the element this step should use. Esc to cancel.');
  await page.keyboard.press('Escape');
  await expect(msg(page)).toHaveText(/Step 2 can’t find/);
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await card(page).getByRole('button', { name: 'No, I’ll point at it' }).click();
  await page.hover('#archive');
  await page.click('#archive');
  await expect(msg(page)).toHaveText('Fixed step 2: button “Archive”.');
  expect((await clicks(page)).archive).toBe(0);
  await expect(page.locator('#status')).toHaveText('');
  await expect(bubble(page)).toHaveText('All done.', { timeout: 15_000 });
  // Pointing is over: the app has its clicks back.
  await page.click('#archive');
  expect((await clicks(page)).archive).toBe(1);
});

test('without save, the fixed guide is downloaded', async ({ page }) => {
  await start(page, '?nosave');
  await expect(msg(page)).toHaveText(/Step 2 can’t find/, { timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await card(page).getByRole('button', { name: 'Yes' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), card(page).getByRole('button', { name: 'Save the guide' }).click()]);
  expect(dl.suggestedFilename()).toBe('invoice.trace.json');
  await expect(msg(page)).toHaveText('Downloaded invoice.trace.json with step 2 fixed.');
});

test('Stop on the card stops the guide', async ({ page }) => {
  await start(page);
  await expect(msg(page)).toHaveText(/Step 2 can’t find/, { timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Stop' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(bubble(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).guides.list().length)).toBe(1);
});

test('someone who may not record sees no card, and the fix code never loads', async ({ page }) => {
  const chunks = await start(page, '?deny');
  await page.waitForFunction(() => document.querySelector('[data-trace-avatar]:not([data-trace-avatar=launcher])'));
  await page.waitForTimeout(2500); // past the step's 1.2 s timeout
  await expect(card(page)).toHaveCount(0);
  expect(chunks).toEqual([]);
});
