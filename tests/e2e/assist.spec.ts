/**
 * AI suggestions in the studio, with real clicks: the recorder notes what appeared after a step ("Saved"),
 * never a masked field's value, and an accepted wait suggestion becomes a step. The model is a stand-in
 * (fixtures/studio/setup.js) that answers from what it is sent.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const studio = (page: Page) => page.locator('[data-trace-avatar=studio]');
const bar = (page: Page) => studio(page).getByRole('toolbar', { name: 'Recording a guide' });
const panel = (page: Page) => studio(page).getByRole('dialog', { name: 'Review the guide' });

test('suggest waits and captions from a real recording; nothing masked is noted or sent', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/studio/app.html?ai');
  await page.getByRole('button', { name: 'Guides' }).click();
  await page.getByRole('menuitem', { name: '● Record a guide' }).click();
  await studio(page).getByRole('button', { name: 'Got it' }).click();
  await page.click('#new');
  await expect(page.locator('#status')).toHaveText('Saved');
  await page.click('#pw');
  await page.keyboard.type('hunter22');
  await page.click('#check');
  await expect(page.locator('#echo')).toHaveText('Checked hunter22');
  await page.waitForTimeout(300);
  await bar(page).getByRole('button', { name: '■ Stop' }).click();
  const steps = panel(page).getByRole('list', { name: 'Steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(4); // click New, click the password field, type it, click Check

  await panel(page).getByRole('button', { name: '✨ Suggest captions, waits, a title' }).click();
  await panel(page).getByRole('button', { name: 'Waits' }).click();
  await panel(page).getByRole('button', { name: 'Accept: After step 1, wait until the page shows' }).click();
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(1)).toContainText('Wait for "Saved"');

  await panel(page).getByRole('button', { name: 'Captions' }).click();
  await panel(page).getByRole('button', { name: 'Accept all' }).click();
  await expect(panel(page).getByRole('textbox', { name: 'Caption for step 1' })).toHaveValue('Step 1: click');

  const calls = await page.evaluate(() => (window as unknown as { aiCalls: Array<{ task: string; input: { appeared?: Array<{ after: number; appeared: string[] }> } }> }).aiCalls);
  const waits = calls.find((c) => c.task === 'waits')!;
  expect(waits.input.appeared!.find((a) => a.after === 1)!.appeared).toContain('Saved');
  expect(waits.input.appeared!.flatMap((a) => a.appeared)).toContain('Password ok');
  // The echoed password was never noted, and nothing typed went anywhere.
  expect(JSON.stringify(calls)).not.toContain('hunter22');
});
