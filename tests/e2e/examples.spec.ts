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

const readmeHtml = async () => {
  const { readFileSync } = await import('node:fs');
  return [...readFileSync('README.md', 'utf8').matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/trace-avatar\/dist\//g, '/dist/'));
};

test('the README Show me quick start works as written, and leaves the page alone', async ({ page }) => {
  const snippet = (await readmeHtml())[0];
  expect(snippet).toContain('/dist/trace.min.js');
  await page.goto('/tests/e2e/fixtures/blank.html');
  await page.setContent(`<!doctype html><html><body>
    <button>New invoice</button><label>Customer <input></label><button>Send invoice</button>
    ${snippet}</body></html>`);
  const host = page.locator('[data-trace-avatar]');
  await expect(host.locator('.bubble')).toHaveText('Start from New invoice.');
  await expect(host.locator('.chip')).toHaveText('Ada Stores', { timeout: 8000 });
  await expect(host.locator('.bubble')).toHaveText('Send it — done.', { timeout: 8000 });
  await expect(page.getByRole('textbox', { name: 'Customer' })).toHaveValue('');
});

test('the README Do it for me quick start works as written: the button runs it and the form gets filled', async ({ page }) => {
  const snippet = (await readmeHtml())[1];
  expect(snippet).toContain('/dist/trace-perform.min.js');
  const trace = { version: 1, steps: [
    { type: 'click', target: { role: 'button', name: 'New invoice' } },
    { type: 'type', target: { role: 'textbox', name: 'Customer' }, text: 'Ada Stores' },
    { type: 'click', target: { text: 'Send invoice' } },
  ] };
  await page.route('**/tours/invoice.trace.json', (r) => r.fulfill({ json: trace }));
  await page.goto('/tests/e2e/fixtures/blank.html');
  await page.setContent(`<!doctype html><html><body>
    <button>New invoice</button><label>Customer <input></label>
    <button onclick="document.getElementById('out').textContent = 'Sent to ' + document.querySelector('input').value">Send invoice</button>
    <p id="out"></p>
    ${snippet}</body></html>`);
  await page.waitForTimeout(300);
  await expect(page.locator('[data-trace-avatar]')).toHaveCount(0); // nothing until asked
  await page.click('#do-it');
  await expect(page.locator('#out')).toHaveText('Sent to Ada Stores', { timeout: 15_000 });
});

test('the README Do it for me trace is valid', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const block = /```jsonc\n(\{\n  "version": 1,\n  "meta": \{ "title": "Start a task"[\s\S]*?)```/.exec(readFileSync('README.md', 'utf8'))![1];
  await page.goto('/tests/e2e/fixtures/blank.html');
  await page.addScriptTag({ url: '/dist/trace.min.js' });
  expect(await page.evaluate((t) => (window as any).TraceAvatar.validate(JSON.parse(t)).errors, block)).toEqual([]);
});

test('vanilla example, Show me: plays over the page and leaves the form empty', async ({ page }) => {
  await page.goto('/examples/vanilla-html/');
  await expect(page.locator('#show')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-trace-avatar]').locator('.bubble')).toHaveText('Send it — done.', { timeout: 20_000 });
  await expect(page.locator('#customer')).toHaveValue('');
  await expect(page.locator('#sent')).toHaveText('');
});

test('vanilla example, Do it for me: fills the form, totals it and sends it', async ({ page }) => {
  await page.goto('/examples/vanilla-html/');
  await page.fill('#customer', 'leftover');
  await page.click('#do');
  await expect(page.locator('#do')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores for ₦125,000.', { timeout: 20_000 });
  await expect(page.locator('#customer')).toHaveValue('Ada Stores');
  await expect.poll(() => page.evaluate(() => (window as any).guide.state)).toBe('paused'); // the trace's pause step
  // ?mode=perform opens straight into it.
  await page.goto('/examples/vanilla-html/?mode=perform');
  await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores for ₦125,000.', { timeout: 20_000 });
});

test('playground, Do it for me: plays the sample for real, and hands a masked field to the viewer', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.locator('#json')).toHaveValue(/Create your first invoice/);
  await page.selectOption('#mode', 'perform');
  await page.click('#play');
  await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores for ₦125,000.', { timeout: 20_000 });

  // Record: the amount is masked (only Customer is data-trace-reveal), so Do it for me asks the viewer for it.
  await page.fill('#customer', ''); // the run above filled it
  await page.fill('#amount', '');
  await page.click('#record');
  await page.click('#customer');
  await page.keyboard.type('Ada');
  await page.click('#amount');
  await page.keyboard.type('5000');
  await page.click('#send');
  await page.click('#record');
  const json = JSON.parse(await page.locator('#json').inputValue());
  expect(json.steps.find((x: { mask?: boolean }) => x.mask)).toMatchObject({ type: 'type', target: { sel: '#amount' } });
  await page.click('#play'); // still Do it for me: the form is cleared first
  await expect(page.locator('#status')).toHaveText(/your turn/, { timeout: 15_000 });
  await expect(page.locator('#customer')).toHaveValue('Ada');
  await expect(page.locator('#amount')).toBeFocused();
  await page.keyboard.type('7000');
  await page.evaluate(() => (window as any).pg.current().play());
  await expect(page.locator('#sent')).toHaveText('Sent to Ada for ₦7,000.', { timeout: 15_000 });
});

test('playground, Show me: never touches the form', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.locator('#json')).toHaveValue(/Create your first invoice/);
  await page.click('#play');
  await expect.poll(() => page.evaluate(() => (window as any).pg.steps.length), { timeout: 20_000 }).toBeGreaterThanOrEqual(7);
  await expect(page.locator('#customer')).toHaveValue('');
  await expect(page.locator('#sent')).toHaveText('');
});

test('React example, ShowOrDo: Show me leaves React state alone; Do it for me fills and sends', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/react-example.html');
  await page.getByRole('button', { name: 'Show me' }).click();
  await expect(page.locator('[data-trace-avatar]').locator('.bubble')).toHaveText('Send it.', { timeout: 15_000 });
  await expect(page.locator('[data-trace-avatar]')).toHaveCount(0, { timeout: 15_000 }); // onEnd unmounts it
  await expect(page.getByRole('textbox', { name: 'Customer' })).toHaveValue('');
  await expect(page.locator('#sent')).toHaveText('');
  await page.getByRole('button', { name: 'Do it for me' }).click();
  await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores', { timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Customer' })).toHaveValue('Ada Stores');
});

test('React example, DoItForMe: performs the tour, then unmounts on end', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/react-example.html?example=do');
  await page.getByRole('button', { name: 'Do it for me' }).click();
  await expect(page.locator('#sent')).toHaveText('Sent to Ada Stores', { timeout: 15_000 });
  await expect(page.locator('[data-trace-avatar]')).toHaveCount(0, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).resets)).toBe(0); // onReset only runs before a restart
});

for (const path of ['/playground/', '/examples/vanilla-html/']) {
  test(`${path} totals an amount typed with separators`, async ({ page }) => {
    await page.goto(path);
    for (const [typed, shown] of [['46,000', '₦46,000'], ['1,250.5', '₦1,250.5'], ['abc', '₦0'], ['', '₦0']]) {
      await page.fill('#amount', typed);
      await expect(page.locator('#total')).toHaveText(shown);
    }
  });
}
