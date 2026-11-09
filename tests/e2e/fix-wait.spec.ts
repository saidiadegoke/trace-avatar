import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// E8: a guide waits for "Saved", but the app now says "Changes stored". The author fixes the wait where it stalled.
const APP = '/tests/e2e/fixtures/fix-wait/app.html';
const card = (page: Page) => page.locator('[data-trace-avatar=fix]').locator('.card');
const msg = (page: Page) => card(page).locator('.msg');
const bubble = (page: Page) => page.locator('[data-trace-avatar]:not([data-trace-avatar=fix]):not([data-trace-avatar=launcher])').locator('.bubble');
const saved = (page: Page) => page.evaluate(() => (window as any).saved);
const clicks = (page: Page) => page.evaluate(() => (window as any).clicks);
const start = async (page: Page, q = '') => {
  await page.goto(APP + q);
  await page.waitForFunction(() => (window as any).guides?.manifest);
  await page.evaluate(() => (window as any).guides.play('save', { mode: 'perform' }));
  await expect(msg(page)).toHaveText('Step 2 waited for “Saved”, which never showed.', { timeout: 15_000 });
};

test('Do it for me stalls on the wait; the author takes the guess, the guide finishes, and Save gets the new text', async ({ page }) => {
  await start(page);
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await expect(msg(page)).toHaveText('Is it “Changes stored”?');
  await card(page).getByRole('button', { name: 'Yes' }).click();
  await expect(msg(page)).toHaveText('Fixed step 2: it waits for “Changes stored”.');
  await expect(bubble(page)).toHaveText('All done.', { timeout: 15_000 });
  expect((await clicks(page)).save).toBe(1);   // carried on after the wait: Save isn't clicked again
  await card(page).getByRole('button', { name: 'Save the guide' }).click();
  await expect(msg(page)).toHaveText('Saved: the guide is fixed for everyone.');
  const [s] = await saved(page);
  expect(s.trace.steps[1]).toEqual({ type: 'wait', until: { text: 'Changes stored' }, timeout: 2500, say: 'Saving…' });
  expect(s.entry).toMatchObject({ id: 'save', title: 'Save an invoice' });
  expect(JSON.stringify(s)).not.toContain('Ada Stores');
});

test('a message that came and went before the stall is still guessed, as seen while waiting', async ({ page }) => {
  await start(page, '?toast');
  await expect(page.locator('#msg')).toHaveText('');
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await expect(msg(page)).toHaveText('Is it “Invoice stored”? (seen while waiting)');
  await card(page).getByRole('button', { name: 'Yes' }).click();
  await card(page).getByRole('button', { name: 'Save the guide' }).click();
  expect((await saved(page))[0].trace.steps[1].until).toEqual({ text: 'Invoice stored' });
});

test('pointing at the text picks it, and the click never reaches the app', async ({ page }) => {
  await start(page);
  await card(page).getByRole('button', { name: 'Fix this step' }).click();
  await card(page).getByRole('button', { name: 'No, I’ll point at it' }).click();
  await expect(msg(page)).toHaveText('Click the text this step should wait for. Esc to cancel.');
  await page.locator('#msg').click();
  await expect(msg(page)).toHaveText('Fixed step 2: it waits for “Changes stored”.');
  expect((await clicks(page)).msg).toBe(0);
  await expect(bubble(page)).toHaveText('All done.', { timeout: 15_000 });
});

test('Remove this wait drops the step, moves its caption on, and the guide finishes', async ({ page }) => {
  await start(page);
  await card(page).getByRole('button', { name: 'Remove this wait' }).click();
  await expect(msg(page)).toHaveText('Removed step 2 (the wait).');
  await expect(bubble(page)).toHaveText('All done.', { timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Save the guide' }).click();
  const steps = (await saved(page))[0].trace.steps;
  expect(steps).toHaveLength(2);
  expect(steps[1]).toEqual({ type: 'note', say: 'All done.' });   // it had its own caption: kept
});

test('a viewer who may not record sees no card, only the player’s own stall', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (r) => { if (r.url().includes('trace-fix')) chunks.push(r.url()); });
  await page.goto(`${APP}?deny`);
  await page.waitForFunction(() => (window as any).guides?.manifest);
  await page.evaluate(() => (window as any).guides.play('save', { mode: 'perform' }));
  await expect.poll(async () => (await clicks(page)).save, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(4000);
  await expect(card(page)).toHaveCount(0);
  expect(chunks).toEqual([]);
});
