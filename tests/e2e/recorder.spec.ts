import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const APP = '/tests/e2e/fixtures/app.html';

async function record(page: Page, act: () => Promise<void>) {
  await page.addScriptTag({ url: '/dist/trace-record.min.js' });
  await page.evaluate(() => {
    (window as any).rec = (window as any).TraceAvatarRecord.createRecorder({ title: 'e2e' });
    (window as any).rec.start();
  });
  await act();
  return page.evaluate(() => (window as any).rec.stop());
}

test('records real input into a valid trace that replays onto the same elements', async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(() => document.getElementById('customer')!.setAttribute('data-trace-reveal', ''));
  const trace = await record(page, async () => {
    await page.mouse.move(50, 50);
    await page.click('[data-testid=new-invoice]');
    await page.click('#customer');
    await page.keyboard.type('Ada Stores');
    await page.keyboard.press('Enter');
    await page.click('#save', { position: { x: 4, y: 4 } });
    await page.dblclick('#row-2');
    await page.locator('#panel').evaluate((el) => el.scrollBy(0, 120));
    await page.waitForTimeout(400);
  });
  const valid = await page.evaluate((t) => (window as any).TraceAvatar.validate(t), trace);
  expect(valid.errors).toEqual([]);
  expect(trace.steps.map((s: { type: string }) => s.type)).toEqual(['click', 'click', 'type', 'key', 'click', 'dblclick', 'scroll']);
  expect(trace.steps[0].target.sel).toBe('[data-testid="new-invoice"]');
  expect(trace.steps[2]).toMatchObject({ text: 'Ada Stores', target: { sel: '#customer', role: 'textbox', name: 'Customer' } });
  expect(trace.steps[3].keys).toBe('Enter');
  expect(trace.steps[4].target.at.rx).toBeLessThan(0.3);
  expect(trace.steps[6]).toMatchObject({ target: { sel: '#panel' }, to: { y: 120 } });
  expect(trace.path.length).toBeGreaterThan(2);

  // Replay on a fresh page at another size: every step finds its element by selector.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP);
  await page.evaluate((t) => (window as any).start(t, { rate: 2, takeover: 'ignore' }), trace);
  await page.evaluate(() => (window as any).t.play());
  await expect.poll(() => page.evaluate(() => (window as any).t.state), { timeout: 20_000 }).toBe('ended');
  const log = await page.evaluate(() => (window as any).log);
  expect(log.map((e: { by: string }) => e.by)).toEqual(['sel', 'sel', 'sel', null, 'sel', 'sel', 'sel']);
});

test('masks typed text by default and passwords always', async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(() => {
    document.querySelector('main section')!.insertAdjacentHTML('beforeend', '<input id="pw" type="password" data-trace-reveal>');
  });
  const trace = await record(page, async () => {
    await page.fill('#customer', '');
    await page.click('#customer');
    await page.keyboard.type('secret co');
    await page.click('#pw');
    await page.keyboard.type('hunter2');
  });
  expect(trace.steps.filter((s: { type: string }) => s.type === 'type').map((s: { text: string; mask: boolean }) => [s.text, s.mask]))
    .toEqual([['•••••••••', true], ['•••••••', true]]);
  expect(JSON.stringify(trace)).not.toMatch(/secret co|hunter2/);
});

test('ignores the overlay and [data-trace-ignore] while recording', async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('afterbegin', '<div data-trace-ignore><button id="tool">tool</button></div>');
    (window as any).start({ version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, hold: 60000 }] }, { controls: true, takeover: 'ignore' });
  });
  const trace = await record(page, async () => {
    await page.click('#tool');
    await page.locator('[data-trace-avatar]').locator('button[aria-label="Play"]').click();
    await page.click('#settings');
  });
  expect(trace.steps.map((s: { target?: { sel: string } }) => s.target?.sel)).toEqual(['#settings']);
});

test('playground: record, then play the recording back', async ({ page }) => {
  await page.goto('/playground/');
  await page.click('#record');
  await expect(page.locator('#status')).toHaveText(/Recording/);
  await page.click('[data-testid=new-invoice]');
  await page.click('#customer');
  await page.keyboard.type('Ada');
  await page.click('#send');
  await page.click('#record');
  await expect(page.locator('#status')).toHaveText(/Recorded 4 steps/);
  const json = JSON.parse(await page.locator('#json').inputValue());
  expect(json.steps.map((x: { type: string }) => x.type)).toEqual(['click', 'click', 'type', 'click']);
  expect(json.steps[2]).toMatchObject({ type: 'type', text: 'Ada' });
  await page.fill('#customer', '');
  await page.click('#play');
  await expect.poll(() => page.evaluate(() => (window as any).pg.steps), { timeout: 15_000 }).toEqual([0, 1, 2, 3]);
  const download = page.waitForEvent('download');
  await page.click('#download');
  expect((await download).suggestedFilename()).toBe('recorded-in-the-playground.trace.json');
});
