import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const APP = '/tests/e2e/fixtures/studio/app.html';
const studio = (page: Page) => page.locator('[data-trace-avatar=studio]');
const bar = (page: Page) => studio(page).getByRole('toolbar', { name: 'Recording a guide' });
const panel = (page: Page) => studio(page).getByRole('dialog', { name: 'Review the guide' });

async function startFromLauncher(page: Page) {
  await page.goto(APP);
  await page.getByRole('button', { name: 'Guides' }).click();
  await page.getByRole('menuitem', { name: '● Record a guide' }).click();
  await expect(bar(page)).toBeVisible();
  await studio(page).getByRole('button', { name: 'Got it' }).click();
}

test('record in the app: toolbar, caption, wait picker, review, Show me test play, save', async ({ page }) => {
  await startFromLauncher(page);
  await page.click('#new');
  await bar(page).getByRole('button', { name: '+ Caption' }).click();
  await bar(page).getByRole('textbox', { name: 'Caption for the last step' }).fill('Start a new invoice');
  await bar(page).getByRole('button', { name: 'Add', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Wait for…' }).click();
  await page.click('#status'); // picked, not clicked in the app
  await bar(page).getByRole('textbox', { name: 'Text to wait for' }).fill('Saved');
  await bar(page).getByRole('button', { name: 'Until it shows this' }).click();
  await page.click('#customer');
  await page.keyboard.type('Ada Stores');
  await expect(bar(page)).toContainText('steps');
  await bar(page).getByRole('button', { name: '■ Stop' }).click();

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('listitem')).toHaveCount(4);
  await expect(panel(page).getByRole('listitem').nth(1)).toContainText('Wait for "Saved"');
  await panel(page).getByRole('textbox', { name: 'Title' }).fill('Create an invoice');
  await expect(panel(page).getByRole('textbox', { name: 'Id' })).toHaveValue('create-an-invoice');

  // Test it: reset the page first, then Show me plays and the review comes back.
  await page.evaluate(() => { (document.getElementById('status') as HTMLElement).textContent = 'Draft'; (document.getElementById('customer') as HTMLInputElement).value = ''; });
  await panel(page).getByRole('button', { name: '▶ Show me' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(panel(page)).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByRole('status').first()).toHaveText('Played to the end.');

  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page)).toContainText('Saved.');
  const saved = await page.evaluate(() => (window as any).saved);
  expect(saved).toHaveLength(1);
  const { trace, entry } = saved[0];
  expect(entry).toEqual({ id: 'create-an-invoice', title: 'Create an invoice', trace: 'create-an-invoice.trace.json', modes: ['overlay', 'perform'], pages: [APP] });
  expect(trace.steps.map((s: { type: string }) => s.type)).toEqual(['click', 'wait', 'click', 'type']);
  expect(trace.steps[0].say).toBe('Start a new invoice');
  expect(trace.steps[1]).toMatchObject({ until: { text: 'Saved' }, target: { sel: '#status' } });
  expect(trace.steps[3].text).toBe('Ada Stores');
  const valid = await page.evaluate((t) => (window as any).TraceAvatar.validate(t), trace);
  expect(valid.errors).toEqual([]);

  await panel(page).getByRole('button', { name: 'Close the studio' }).click();
  await expect(studio(page)).toHaveCount(0);
  await page.reload();
  await expect(studio(page)).toHaveCount(0);
});

test('a guide across a full page load, then Do it for me plays it for real across the load', async ({ page }) => {
  await startFromLauncher(page);
  await page.click('#new');
  await page.click('#next');
  await page.waitForURL('**/page2.html');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText('2 steps');
  await page.click('#finish');
  await bar(page).getByRole('button', { name: '■ Stop' }).click();
  await expect(panel(page).getByRole('listitem')).toHaveCount(3);
  await panel(page).getByRole('textbox', { name: 'Title' }).fill('Two pages');

  // Do it for me starts where the guide starts and carries on after the load.
  await page.goto(APP);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('textbox', { name: 'Title' })).toHaveValue('Two pages');
  await panel(page).getByRole('button', { name: '▶ Do it for me' }).click();
  await page.waitForURL('**/page2.html', { timeout: 20_000 });
  await expect(page.locator('#done')).toHaveText('Finished', { timeout: 20_000 });
  await expect(panel(page)).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByRole('status').first()).toHaveText('Played to the end.');
});

test('the mask picker cannot reveal a password; masked text is never kept', async ({ page }) => {
  await startFromLauncher(page);
  await bar(page).getByRole('button', { name: 'Mask / Reveal' }).click();
  await page.click('#pw');
  await expect(bar(page)).toContainText('This field is always masked.');
  await expect(bar(page).getByRole('button', { name: 'Reveal', exact: true })).toBeDisabled();
  await page.click('#pw');
  await page.keyboard.type('hunter2');
  await bar(page).getByRole('button', { name: 'Mask / Reveal' }).click();
  await page.click('#customer');
  await bar(page).getByRole('button', { name: 'Mask', exact: true }).click();
  await page.click('#customer');
  await page.keyboard.type('Secret Co');
  await bar(page).getByRole('button', { name: '■ Stop' }).click();
  await panel(page).getByRole('textbox', { name: 'Title' }).fill('Masked');
  await panel(page).getByText('Advanced: JSON').click();
  const box = panel(page).getByRole('textbox', { name: 'Trace JSON' });
  await expect(box).not.toHaveValue(''); // filled when the fold opens
  const json = await box.inputValue();
  expect(json).not.toContain('hunter2');
  expect(json).not.toContain('Secret Co');
  expect(JSON.parse(json).steps.filter((s: { type: string }) => s.type === 'type').map((s: { mask?: boolean }) => s.mask)).toEqual([true, true]);
});

test('Alt+Shift+R and ?trace-record=1 start recording; neither works when not allowed, and the studio never loads', async ({ page }) => {
  await page.goto(APP);
  await page.keyboard.press('Alt+Shift+KeyR');
  await expect(bar(page)).toBeVisible();
  await page.goto(`${APP}?trace-record=1`);
  await expect(bar(page)).toBeVisible(); // carried on (and asked again: the same recording)
  expect(new URL(page.url()).search).toBe('');

  await page.goto(`${APP}?deny`);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${APP}?deny&trace-record=1`);
  await page.keyboard.press('Alt+Shift+KeyR');
  await page.getByRole('button', { name: 'Guides' }).click();
  await expect(page.getByRole('menuitem', { name: '● Record a guide' })).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(studio(page)).toHaveCount(0);
  expect(await page.locator('script[src*="trace-studio"]').count()).toBe(0);
});

test('?trace-edit=id opens a saved guide in the review; its save says which guide it replaces', async ({ page }) => {
  await page.goto(`${APP}?trace-edit=saved-one`);
  await expect(panel(page)).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await expect(panel(page).getByRole('heading', { name: 'Edit the guide' })).toBeVisible();
  await expect(panel(page).getByRole('textbox', { name: 'Id' })).toHaveValue('saved-one');
  await panel(page).getByRole('textbox', { name: 'Caption for step 1' }).fill('Every invoice starts here.');
  await panel(page).getByRole('button', { name: '▶ Show me' }).click();
  await expect(panel(page)).toBeVisible({ timeout: 20_000 });
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page)).toContainText('Saved.');
  const saved = await page.evaluate(() => (window as any).saved);
  expect(saved[0].info).toEqual({ from: 'saved-one' });
  expect(saved[0].entry).toMatchObject({ id: 'saved-one', title: 'Start an invoice', modes: ['overlay'], pages: ['/elsewhere'] });
  expect(saved[0].trace.steps[0].say).toBe('Every invoice starts here.');

  // Not allowed: the link does nothing and the studio never loads.
  await page.goto(`${APP}?deny&trace-edit=saved-one`);
  await page.waitForTimeout(400);
  await expect(studio(page)).toHaveCount(0);
});
