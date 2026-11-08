import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const APP = '/tests/e2e/fixtures/app.html';

type Log = { index: number; by: string | null; cursor: { x: number; y: number } | null; rect: { x: number; y: number; w: number; h: number } | null };

async function start(page: Page, trace: unknown, opts: Record<string, unknown> = {}) {
  await page.evaluate(([t, o]) => (window as any).start(t, o), [trace, opts] as const);
}
const play = (page: Page) => page.evaluate(() => (window as any).t.play());
const log = (page: Page) => page.evaluate(() => (window as any).log as Log[]);
const events = (page: Page) => page.evaluate(() => (window as any).events as { k: string; e: string | null }[]);
const cursor = (page: Page) => page.evaluate(() => (window as any).cursor() as { x: number; y: number } | null);
const state = (page: Page) => page.evaluate(() => (window as any).t.state as string);
const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const shadow = (page: Page, sel: string) => page.locator('[data-trace-avatar]').locator(sel);
const ended = (page: Page) => expect.poll(() => state(page), { timeout: 15_000 }).toBe('ended');

function expectOn(entry: Log, tolerance = 2) {
  expect(entry.rect, `step ${entry.index} found its element`).not.toBeNull();
  const c = centre(entry.rect!);
  expect(Math.abs(entry.cursor!.x - c.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(entry.cursor!.y - c.y)).toBeLessThanOrEqual(tolerance);
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP);
});

test('lands on each element at its action, found by selector, role+name and text', async ({ page }) => {
  const trace = await (await page.request.get('/tests/e2e/fixtures/basic.trace.json')).json();
  await start(page, trace, { rate: 2 });
  await play(page);
  await ended(page);
  const entries = await log(page);
  expect(entries.map((e) => e.by)).toEqual(['sel', 'role', 'text', 'text']);
  entries.forEach((e) => expectOn(e));
});

test('the overlay never takes clicks: the page underneath gets them', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, hold: 4000 }] }, { takeover: 'ignore' });
  await play(page);
  await page.waitForTimeout(400);
  await page.click('#save');
  expect(await page.evaluate(() => (window as any).clicks)).toContain('save');
  // The overlay layer itself is click-through.
  const pe = await page.locator('[data-trace-avatar]').evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pe).toBe('none');
});

test('follows its element when the page scrolls', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, hold: 5000, t: 300 }] }, { takeover: 'ignore' });
  await play(page);
  await expect.poll(async () => (await log(page)).length).toBe(1);
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(150);
  const r = await page.locator('#save').boundingBox();
  const c = await cursor(page);
  expect(Math.abs(c!.y - (r!.y + r!.height / 2))).toBeLessThanOrEqual(2);
});

test('scrolls an off-screen element into view and lands on it', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'click', target: { sel: '#footer-btn' } }] });
  await play(page);
  await ended(page);
  const [e] = await log(page);
  expectOn(e, 3);
  // The click lands while the element's centre is on screen (a smooth scroll may still be settling).
  const vh = await page.evaluate(() => innerHeight);
  const c = centre(e.rect!);
  expect(c.y).toBeGreaterThanOrEqual(0);
  expect(c.y).toBeLessThanOrEqual(vh);
});

test('the ring follows an element inside a scrolled panel', async ({ page }) => {
  await page.evaluate(() => { document.getElementById('panel')!.scrollTop = 500; });
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#row-10' }, hold: 5000, t: 200 }] }, { takeover: 'ignore' });
  await play(page);
  await expect.poll(async () => (await log(page)).length).toBe(1);
  await page.evaluate(() => { document.getElementById('panel')!.scrollTop -= 60; });
  await page.waitForTimeout(150);
  const row = await page.locator('#row-10').boundingBox();
  const ring = await shadow(page, '.ring').boundingBox();
  expect(Math.abs(ring!.y - (row!.y - 4))).toBeLessThanOrEqual(2);
  expect(Math.abs(ring!.height - (row!.height + 8))).toBeLessThanOrEqual(2);
  await expect(shadow(page, '.ring')).toHaveClass(/on/);
});

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`a trace recorded at 1440px plays on ${vp.width}px, including the mobile layout`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto(APP);
    const trace = {
      version: 1,
      meta: { viewport: { w: 1440, h: 900 } },
      steps: [
        { type: 'click', target: { sel: '#settings', xy: { x: 300, y: 30 } } },
        { type: 'click', target: { sel: '#save', xy: { x: 400, y: 120 } } },
        { type: 'hover', target: { sel: '#row-2', xy: { x: 1000, y: 150 } }, hold: 200 },
      ],
    };
    await start(page, trace, { rate: 2 });
    await play(page);
    await ended(page);
    const entries = await log(page);
    expect(entries.map((e) => e.by)).toEqual(['sel', 'sel', 'sel']);
    entries.forEach((e) => expectOn(e, 3));
  });
}

test('falls back to scaled recorded pixels when an element is gone', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(APP);
  await start(page, { version: 1, meta: { viewport: { w: 1440, h: 900 } }, steps: [{ type: 'click', target: { sel: '#nothing', xy: { x: 400, y: 200 } } }] });
  await play(page);
  await ended(page);
  const [e] = await log(page);
  expect(e.by).toBe('xy');
  expect(e.cursor).toEqual({ x: 200, y: 100 });
});

test('waits for an element that appears late, saying what it is looking for', async ({ page }) => {
  await page.evaluate(() => (window as any).addLater(1200));
  await start(page, { version: 1, steps: [{ type: 'click', target: { sel: '#late', role: 'button', name: 'Late' }, t: 100 }] });
  await play(page);
  await expect.poll(() => state(page)).toBe('waiting');
  await expect(shadow(page, '.bubble')).toHaveText('Looking for “Late”…');
  await ended(page);
  expect((await events(page)).map((e) => e.k)).not.toContain('stalled');
  expectOn((await log(page))[0]);
});

test('reports a stall when an element never appears, then carries on', async ({ page }) => {
  await start(page, { version: 1, steps: [
    { type: 'click', target: { sel: '#never' }, timeout: 300 },
    { type: 'click', target: { sel: '#save' } },
  ] });
  await play(page);
  await ended(page);
  expect(await events(page)).toContainEqual({ k: 'stalled', e: 'not-found' });
  const entries = await log(page);
  expect(entries.map((e) => e.index)).toEqual([0, 1]);
  expectOn(entries[1]);
});

test('reduced motion: the cursor jumps instead of travelling, and no ripples', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(APP);
  await start(page, { version: 1, steps: [
    { type: 'click', target: { sel: '[data-testid=new-invoice]' }, t: 300 },
    { type: 'click', target: { sel: '#footer-btn' }, t: 2000 },
  ] });
  const samples = await page.evaluate(async () => {
    const out: { x: number; y: number }[] = [];
    (window as any).t.play();
    for (let k = 0; k < 120; k += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      const c = (window as any).cursor();
      if (c) out.push(c);
    }
    return out;
  });
  const distinct = new Set(samples.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
  // Two resting places (and possibly a frame of scroll settling), never a path of many in-between points.
  expect(distinct.size).toBeLessThanOrEqual(4);
  await expect(shadow(page, '.rip.a')).toHaveCount(0);
});

test('real viewer input pauses the guide; the play button resumes it; controls are not a takeover', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, hold: 8000 }] }, { controls: true });
  await play(page);
  await page.waitForTimeout(200);
  await shadow(page, 'button[aria-label="Playback speed"]').click();
  expect(await state(page)).toBe('playing');
  await page.click('#customer');
  expect(await state(page)).toBe('paused');
  await expect(shadow(page, '[aria-live]')).toHaveText(/Your turn/);
  await shadow(page, 'button[aria-label="Play"]').click();
  expect(await state(page)).toBe('playing');
});

test('controls step through and show the count', async ({ page }) => {
  const trace = await (await page.request.get('/tests/e2e/fixtures/basic.trace.json')).json();
  await start(page, trace, { controls: true });
  await expect(shadow(page, '.n')).toHaveText('1 / 4');
  await shadow(page, 'button[aria-label="Next step"]').click();
  await expect(shadow(page, '.n')).toHaveText('2 / 4');
  await shadow(page, 'button[aria-label="Previous step"]').click();
  await expect(shadow(page, '.n')).toHaveText('1 / 4');
});

test('captions: bubble with a live region, or a bar', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, say: 'Save often.', hold: 3000 }] });
  await play(page);
  await expect(shadow(page, '.bubble')).toHaveText('Save often.');
  await expect(shadow(page, '.bubble')).toHaveClass(/on/);
  await expect(shadow(page, '[aria-live]')).toHaveText('Save often.');
  await page.evaluate(() => (window as any).t.destroy());
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, say: 'In a bar.', hold: 3000 }] }, { captions: 'bar' });
  await play(page);
  await expect(shadow(page, '.bar')).toHaveText('In a bar.');
  await expect(shadow(page, '.bar')).toBeVisible();
});

test('typing shows a chip and leaves the real field alone (overlay mode)', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'type', target: { sel: '#customer' }, text: 'Ada Stores', t: 300 }] });
  await play(page);
  await expect(shadow(page, '.chip')).toHaveText(/^A/);
  await expect(shadow(page, '.chip')).toHaveText('Ada Stores', { timeout: 5000 });
  expect(await page.inputValue('#customer')).toBe('');
});

test('key steps show the shortcut', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'key', keys: 'Shift+Enter', t: 200 }] });
  await play(page);
  await expect(shadow(page, '.chip')).toHaveText(/(⇧↵|Shift\+Enter)/);
});

test('scroll steps scroll the page', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'scroll', by: { y: 400 }, t: 100 }] }, { reducedMotion: true });
  await play(page);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400);
});

test('touch traces show a finger dot instead of a pointer', async ({ page }) => {
  await start(page, { version: 1, meta: { pointer: 'touch' }, steps: [{ type: 'hover', target: { sel: '#save' }, hold: 2000 }] });
  await play(page);
  await expect(shadow(page, '.dot')).toBeVisible();
  await expect(shadow(page, '.ptr')).toBeHidden();
});

test('destroy removes the overlay and stops listening', async ({ page }) => {
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, hold: 5000 }] });
  await play(page);
  await page.evaluate(() => (window as any).t.destroy());
  await expect(page.locator('[data-trace-avatar]')).toHaveCount(0);
  await page.click('#customer');
  expect((await events(page)).filter((e) => e.e === 'paused')).toHaveLength(0);
});

test('one frame of playback writes styles only; it never forces layout after writing', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Layout-thrash check uses Chromium tracing via CDP');
  await start(page, { version: 1, steps: [{ type: 'hover', target: { sel: '#save' }, hold: 3000 }] });
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  await play(page);
  await page.waitForTimeout(500);
  const before = (await client.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount')!.value;
  await page.waitForTimeout(1000);
  const after = (await client.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount')!.value;
  // About 60 frames ran; a thrashing loop would add a layout or more per frame.
  expect(after - before).toBeLessThan(20);
});

test('<trace-avatar src> loads a trace and plays it', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/element.html');
  await expect.poll(() => page.evaluate(() => (window as any).steps), { timeout: 15_000 }).toEqual([0, 1, 2, 3]);
});
