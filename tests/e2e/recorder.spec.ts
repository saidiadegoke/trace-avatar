import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const APP = '/tests/e2e/fixtures/app.html';

async function record(page: Page, act: () => Promise<void>, o: Record<string, unknown> = {}) {
  await page.addScriptTag({ url: '/dist/trace-record.min.js' });
  await page.evaluate((opts) => {
    (window as any).rec = (window as any).TraceAvatarRecord.createRecorder({ title: 'e2e', ...opts });
    (window as any).rec.start();
  }, o);
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

test('keeps typed text by default, passwords never; with security on, masks typed text too', async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(() => {
    document.querySelector('main section')!.insertAdjacentHTML('beforeend', '<input id="pw" type="password" data-trace-reveal>');
  });
  const typing = async () => {
    await page.click('#customer');
    await page.keyboard.type('secret co');
    await page.click('#pw');
    await page.keyboard.type('hunter2');
  };
  const typed = (tr: any) => tr.steps.filter((s: { type: string }) => s.type === 'type').map((s: { text: string; mask?: boolean }) => [s.text, !!s.mask]);
  await page.fill('#customer', '');
  const plain = await record(page, typing);
  expect(typed(plain)).toEqual([['secret co', false], ['•••••••', true]]);
  expect(JSON.stringify(plain)).not.toMatch(/hunter2/);
  await page.fill('#customer', '');
  await page.fill('#pw', '');
  const secure = await record(page, typing, { security: true });
  expect(typed(secure)).toEqual([['•••••••••', true], ['•••••••', true]]);
  expect(JSON.stringify(secure)).not.toMatch(/secret co|hunter2/);
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

test('playground: record in the studio, save to the editor, then play the recording back', async ({ page }) => {
  await page.goto('/playground/');
  await page.click('#record');
  await expect(page.locator('#status')).toHaveText(/Recording/);
  const studio = page.locator('[data-trace-avatar=studio]');
  await studio.getByRole('button', { name: 'Got it' }).click();
  await page.click('[data-testid=new-invoice]');
  await page.click('#customer');
  await page.keyboard.type('Ada');
  await page.click('#send');
  await studio.getByRole('button', { name: '■ Stop' }).click();
  const review = studio.getByRole('dialog', { name: 'Review the guide' });
  await expect(review.getByRole('listitem')).toHaveCount(4);
  await review.getByRole('textbox', { name: 'Title' }).fill('Recorded in the playground');
  await review.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#status')).toHaveText(/Saved 4 steps/);
  await review.getByRole('button', { name: 'Close the studio' }).click();
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

test('an app session (two New task links, a rich-text box, a task card) records into steps that replay', async ({ page }) => {
  const SPA = '/tests/e2e/fixtures/spa.html';
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(SPA);
  await page.addScriptTag({ url: '/dist/trace-record.min.js' });
  await page.evaluate(() => {
    (window as any).rec = (window as any).TraceAvatarRecord.createRecorder({ maskByDefault: false });
    (window as any).rec.start();
  });
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  await page.click('header a.btn');
  await page.click('[aria-label=Objective]');
  await page.keyboard.type('This is a test task');
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(4500); // a long pause, like a file picker
  await page.click('nav a[href="/app"]');
  await page.click('a.card');
  const trace = await page.evaluate(() => (window as any).rec.stop());

  expect(trace.meta.url).toBe('/app');
  expect(trace.steps.map((s: { page?: string }) => s.page)).toEqual(['/app', '/app/tasks/new', undefined, '/app/tasks/new', '/app'].map((p, k) => (k === 3 ? undefined : p)));
  expect(trace.steps.map((s: { type: string }) => s.type)).toEqual(['click', 'click', 'type', 'click', 'click']);
  const [newTask, , typed, overview, card] = trace.steps;
  expect(newTask.target.sel).toBe('header a[href="/app/tasks/new"]');
  expect(typed.target.sel).toBe('div[aria-label="Objective"]');
  expect(typed.target.text).toBeUndefined();
  expect(typed.text).toBe('This is a test task');
  expect(overview.target.sel).toBe('a[href="/app"]'); // unique on that view
  expect(card.target.sel ?? '').not.toContain('bfd02a18');
  expect(card.target).toMatchObject({ role: 'link', name: 'This is a test task' });
  expect(overview.t - typed.t).toBeLessThan(3000); // the 4.5 s pause plays back as 1.5 s

  // Replay from the start page at phone width; the viewer clicks along, the guide waits for each view.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SPA);
  await page.evaluate(() => document.getElementById('status')!.textContent = 'Running'); // the card's status moved on
  await page.addScriptTag({ url: '/dist/trace.min.js' });
  await page.evaluate((t) => {
    const w = window as any;
    w.found = [];
    w.g = w.TraceAvatar.createTrace({ trace: t, rate: 2, takeover: 'ignore', autoplay: true });
    w.g.on('step', (e: { index: number; resolvedBy: string | null; element: Element | null }) => w.found.push([e.index, e.element?.getAttribute('aria-label') || e.element?.querySelector('p')?.textContent || e.element?.textContent?.trim(), e.resolvedBy, e.element?.tagName ?? null]));
    w.g.on('stalled', (e: unknown) => w.found.push(['stalled', e]));
  }, trace);
  await expect.poll(() => page.evaluate(() => (window as any).found.length)).toBeGreaterThanOrEqual(1);
  await page.click('header a.btn');
  await expect.poll(() => page.evaluate(() => (window as any).found.length), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await page.click('nav a[href="/app"]');
  await page.evaluate(() => document.getElementById('status')!.textContent = 'Running');
  await expect.poll(() => page.evaluate(() => (window as any).g.state), { timeout: 20_000 }).toBe('ended');
  const found = await page.evaluate(() => (window as any).found);
  expect(found.filter((f: unknown[]) => f[0] === 'stalled')).toEqual([]);

  // The viewer clicked Overview before the guide pointed at it: the guide caught up, skipping that step.
  expect(found.map((f: unknown[]) => f[1])).toEqual(['New task', 'Objective', 'Objective', 'This is a test task']);
});

test('a guide opened on the wrong page says where to go, then plays on; or navigates when the app lets it', async ({ page }) => {
  const SPA = '/tests/e2e/fixtures/spa.html';
  const trace = { version: 1, meta: { viewport: { w: 1280, h: 800 } }, steps: [
    { type: 'click', page: '/app', target: { sel: 'header a[href="/app/tasks/new"]', role: 'link', name: 'New task', xy: { x: 1200, y: 40 } }, say: 'Start a new task.' },
    { type: 'click', page: '/app/tasks/new', target: { sel: 'div[aria-label="Objective"]', role: 'textbox', name: 'Objective', xy: { x: 600, y: 120 } } },
  ] };
  const caption = () => page.evaluate(() => document.querySelector('[data-trace-avatar]')?.shadowRoot?.querySelector('.bubble, .bar')?.textContent ?? '');

  // 1. No navigate: on /app/tasks/new the guide doesn't hunt for "New task" (a link with that name is in the sidebar here).
  await page.goto(SPA);
  await page.evaluate(() => (window as any).go('/app/tasks/new'));
  await page.addScriptTag({ url: '/dist/trace.min.js' });
  await page.evaluate((t) => {
    const w = window as any;
    w.log = [];
    w.g = w.TraceAvatar.createTrace({ trace: t, autoplay: true, takeover: 'ignore' });
    w.g.on('page', (e: { index: number; want: string; at: string }) => w.log.push(['page', e.index, e.want, e.at]));
    w.g.on('step', (e: { index: number }) => w.log.push(['step', e.index]));
  }, trace);
  await expect.poll(caption).toBe('Open /app to continue');
  await page.waitForTimeout(5000); // longer than any element timeout: still waiting, nothing stalled
  expect(await page.evaluate(() => (window as any).g.state)).toBe('waiting');
  expect(await page.evaluate(() => (window as any).log)).toEqual([['page', 0, '/app', '/app/tasks/new']]);
  await page.click('nav a[href="/app"]');
  await expect.poll(() => page.evaluate(() => (window as any).log.length), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => (window as any).log.slice(1, 3))).toEqual([['step', 0], ['page', 1, '/app/tasks/new', '/app']]);
  await page.click('header a.btn');
  await expect.poll(() => page.evaluate(() => (window as any).g.state), { timeout: 10_000 }).toBe('ended');

  // 2. With navigate (the app's router): the guide goes where it needs to, by itself.
  await page.goto(SPA);
  await page.evaluate(() => (window as any).go('/app/tasks/new'));
  await page.addScriptTag({ url: '/dist/trace.min.js' });
  await page.evaluate((t) => {
    const w = window as any;
    w.g = w.TraceAvatar.createTrace({ trace: t, autoplay: true, rate: 2, navigate: (p: string) => w.go(p) });
  }, trace);
  await expect.poll(() => page.evaluate(() => (window as any).g.state), { timeout: 15_000 }).toBe('ended');
  expect(await page.evaluate(() => location.pathname)).toBe('/app/tasks/new');
});
