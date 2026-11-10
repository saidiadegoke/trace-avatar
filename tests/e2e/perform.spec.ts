import { expect, test } from '@playwright/test';

// Perform mode in real browsers: the guide does the steps itself.

test('fills a React form: controlled values reach state, the password is handed to the viewer, wait until "Saved"', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/react-form.html');
  await expect(page.locator('#out')).toHaveText('Not saved');
  await page.addScriptTag({ url: '/dist/trace-perform.min.js' });
  const trace = { version: 1, steps: [
    { type: 'click', target: { role: 'button', name: 'Count 0' }, t: 200 },
    { type: 'type', target: { sel: 'input[name=customer]' }, text: 'Ada Stores', t: 600 },
    { type: 'type', target: { role: 'combobox', name: 'Plan' }, text: 'Pro', t: 1200 },
    { type: 'type', target: { sel: 'textarea' }, text: 'Two lines\nof notes', t: 1600 },
    { type: 'type', target: { sel: 'input[type=password]' }, text: '•••••••', mask: true, t: 2200 },
    { type: 'click', target: { role: 'button', name: 'Save' }, t: 2600 },
    { type: 'wait', until: { text: 'Saved:' }, t: 2700 },
    { type: 'click', target: { role: 'button', name: 'Count 1' }, t: 2900 },
  ] };
  await page.evaluate((t) => {
    const w = window as any;
    w.log = [];
    w.g = w.TraceAvatar.createTrace({ trace: t, rate: 2 });
    for (const k of ['handoff', 'stalled', 'error', 'end'] as const) w.g.on(k, (e: any) => w.log.push([k, e?.index ?? e?.message ?? null]));
    w.g.on('state', (e: any) => { if (e.phase === 'paused') w.log.push(['paused', w.g.state]); });
    w.g.play();
  }, trace);

  // The guide stops at the masked field and hands it over, with the field focused.
  await expect.poll(() => page.evaluate(() => (window as any).log), { timeout: 15_000 }).toContainEqual(['handoff', 4]);
  await expect(page.locator('input[name=customer]')).toHaveValue('Ada Stores');
  await expect(page.locator('select')).toHaveValue('pro');
  await expect(page.locator('textarea')).toHaveValue('Two lines\nof notes');
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible(); // the guide's own click counted…
  expect(await page.evaluate(() => (window as any).g.state)).toBe('paused');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('type'))).toBe('password');

  // The card says so; the viewer types the password (real input), then presses Enter: that carries on.
  await expect(page.locator('[data-trace-avatar] .turn-card')).toContainText('Type in “input[type=password]”, then press Enter.');
  await page.keyboard.type('hunter2');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).g.state), { timeout: 15_000 }).toBe('ended');
  await expect(page.locator('#out')).toHaveText('Saved: Ada Stores / pro / Two lines\nof notes / 7 chars');
  await expect(page.getByRole('button', { name: 'Count 2' })).toBeVisible(); // …and the last click came after "Saved"
  const log = await page.evaluate(() => (window as any).log);
  expect(log.filter(([k]: [string]) => k === 'stalled' || k === 'error')).toEqual([]);
  // …and its own events never looked like a takeover.
  expect(log.filter(([k]: [string]) => k === 'paused')).toHaveLength(1);
});

test('uploads: a sample file is attached as a real pick; without one the viewer chooses, and that carries on; security and values', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/upload.html');
  await page.addScriptTag({ url: '/dist/trace-perform.min.js' });
  const run = (t: unknown, o: Record<string, unknown> = {}) => page.evaluate(([tr, opts]) => {
    const w = window as any;
    w.log = [];
    w.g?.destroy();
    w.g = w.TraceAvatar.createTrace({ trace: tr, rate: 2, ...opts });
    for (const k of ['handoff', 'error', 'end'] as const) w.g.on(k, (e: any) => w.log.push([k, e?.why ?? e?.message ?? null]));
    w.g.play();
  }, [t, o] as const);
  const state = () => page.evaluate(() => (window as any).g.state);

  // A sample file (as text) is attached through the button the person clicked; the app reads it.
  await run({ version: 1, steps: [
    { type: 'upload', target: { role: 'button', name: 'Attach files' }, files: [{ name: 'prices.csv', type: 'text/csv', text: 'item,price\nbread,1200\n' }], t: 200 },
    { type: 'click', target: { role: 'button', name: 'Send' } },
  ] });
  await expect.poll(state, { timeout: 15_000 }).toBe('ended');
  await expect(page.locator('#out')).toHaveText('Sent: prices.csv (text/csv, 22 bytes): item,price');

  // No sample: the viewer's turn, shown on the card; choosing a file carries on by itself.
  await page.evaluate(() => { document.querySelector('#out')!.textContent = ''; });
  await run({ version: 1, steps: [
    { type: 'upload', target: { role: 'button', name: 'Attach files' }, files: [{ name: 'prices.csv', size: 22 }], t: 200 },
    { type: 'click', target: { role: 'button', name: 'Send' } },
  ] });
  await expect.poll(() => page.evaluate(() => (window as any).log), { timeout: 15_000 }).toContainEqual(['handoff', 'no-file']);
  await expect(page.locator('[data-trace-avatar] .turn-card')).toContainText('Choose a file for “Attach files”.');
  await page.locator('#file').setInputFiles({ name: 'mine.txt', mimeType: 'text/plain', buffer: Buffer.from('hello there') });
  await expect.poll(state, { timeout: 15_000 }).toBe('ended');
  await expect(page.locator('#out')).toHaveText('Sent: mine.txt (text/plain, 11 bytes): hello there');
  await expect(page.locator('[data-trace-avatar] .turn-card')).toBeHidden();

  // Security on: the PIN the trace knows is not typed (the viewer's, then Tab carries on); a value stands in for the password.
  await run({ version: 1, steps: [
    { type: 'type', target: { role: 'textbox', name: 'PIN' }, text: '1234', t: 200 },
    { type: 'type', target: { sel: '#pw' }, text: '••••', mask: true },
    { type: 'click', target: { role: 'button', name: 'Sign in' } },
  ] }, { security: true, values: { password: 'demo-pass' } });
  await expect.poll(() => page.evaluate(() => (window as any).log), { timeout: 15_000 }).toContainEqual(['handoff', 'secret']);
  await expect(page.locator('#pin')).toHaveValue('');
  await page.keyboard.type('9876');
  await page.keyboard.press('Tab');
  await expect.poll(state, { timeout: 15_000 }).toBe('ended');
  await expect(page.locator('#signed')).toHaveText('Signed in: pin 9876, password 9 chars');
});

test('runs an app flow: navigates by its own clicks, types into rich text, waits until "Running"', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/tests/e2e/fixtures/spa.html');
  await page.addScriptTag({ url: '/dist/trace-perform.min.js' });
  const trace = { version: 1, steps: [
    { type: 'click', page: '/app', target: { sel: 'header a.btn', role: 'link', name: 'New task' }, t: 200 },
    { type: 'type', page: '/app/tasks/new', target: { role: 'textbox', name: 'Objective' }, text: 'Check prices', t: 700 },
    { type: 'click', target: { role: 'button', name: 'Start task' }, t: 1500, checkpoint: true },
    { type: 'wait', page: '/app', target: { sel: '#status' }, until: { text: 'Running' }, t: 1600, say: 'Starting…' },
  ] };
  await page.evaluate((t) => {
    const w = window as any;
    w.log = [];
    w.g = w.TraceAvatar.createTrace({ trace: t, rate: 2, autoplay: true });
    for (const k of ['step', 'stalled', 'error', 'end'] as const) w.g.on(k, (e: any) => w.log.push([k, e?.index ?? e?.reason ?? e?.message ?? null, location.pathname, document.getElementById('status')?.textContent ?? null]));
  }, trace);
  await expect.poll(() => page.evaluate(() => (window as any).g.state), { timeout: 20_000 }).toBe('ended');
  expect(await page.evaluate(() => (window as any).objective)).toBe('Check prices');
  const log = await page.evaluate(() => (window as any).log);
  expect(log.filter(([k]: [string]) => k === 'stalled' || k === 'error')).toEqual([]);
  // The wait fired as soon as the status read Running (not before), then the guide ended.
  expect(log.slice(-2)).toEqual([['step', 3, '/app', 'Running'], ['end', null, '/app', 'Running']]);
});

test('resumes after a full page load (resumeKey), and starts afresh when there is nothing to resume', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/multi-a.html');
  // Step 0 clicks the link: a real navigation; page B picks up at step 1 and finishes.
  await expect(page).toHaveURL(/multi-b\.html$/, { timeout: 15_000 });
  await expect(page.locator('#done')).toHaveText('Finished on B', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).guide.state)).toBe('ended');
  expect(await page.evaluate(() => (window as any).log)).toEqual([1]);
  expect(await page.evaluate(() => sessionStorage.getItem('trace-avatar:multi'))).toBeNull(); // forgotten at the end

  // Opening B fresh: nothing saved, so the guide starts at step 0, which belongs to page A.
  await page.reload();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).log)).toEqual([]);
  expect(await page.locator('#done').textContent()).toBe('Not yet');
  expect(await page.evaluate(() => (window as any).guide.state)).toBe('waiting');
});
