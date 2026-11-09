import { expect, test } from '@playwright/test';

const A = '/tests/e2e/fixtures/rec-a.html';

test('a recording carries on across a full page load: one trace, each step on its page', async ({ page }) => {
  await page.goto(A);
  await page.evaluate(() => (window as any).rec.start());
  await page.mouse.move(40, 40);
  await page.click('#one');
  await page.click('#to-b');
  await page.waitForURL('**/rec-b.html');
  expect(await page.evaluate(() => [(window as any).rec.restored, (window as any).rec.state, (window as any).rec.count])).toEqual([true, 'recording', 2]);
  await page.click('#two');
  const trace = await page.evaluate(() => (window as any).rec.stop());
  expect(trace.meta.url).toBe(A);
  expect(trace.steps.map((s: { type: string; page: string }) => [s.type, s.page])).toEqual([
    ['click', A], ['click', undefined], ['click', '/tests/e2e/fixtures/rec-b.html'],
  ]); // a step names its page only when it changes
  expect(trace.steps[2].target.sel).toBe('#two');
  expect(trace.steps.every((s: { type: string }) => s.type !== 'note')).toBe(true);
  // Stopped: nothing is kept, the next load starts idle.
  await page.reload();
  expect(await page.evaluate(() => [(window as any).rec.restored, (window as any).rec.state])).toEqual([false, 'idle']);
});

test('back from another origin (a sign-in): a pause step asks the viewer to sign in, and the guide requires it', async ({ page }) => {
  await page.goto(A);
  await page.evaluate(() => (window as any).rec.start());
  await page.click('#one');
  // Off to another origin (localhost vs 127.0.0.1), then back by a link.
  const back = new URL('/tests/e2e/fixtures/rec-b.html', page.url()).href;
  await page.goto(`http://localhost:4173/tests/e2e/fixtures/rec-signin.html?to=${encodeURIComponent(back)}`);
  await page.click('#back');
  await page.waitForURL('**/rec-b.html');
  expect(await page.evaluate(() => (window as any).rec.restored)).toBe(true);
  await page.click('#two');
  const trace = await page.evaluate(() => (window as any).rec.stop());
  expect(trace.steps.map((s: { type: string }) => s.type)).toEqual(['click', 'note', 'click']);
  expect(trace.steps[1]).toMatchObject({ say: 'Sign in, then press play.', pause: true });
  expect(trace.meta.requires).toEqual(['signed-in']);
  const valid = await page.evaluate((t) => {
    const s = document.createElement('script');
    s.src = '/dist/trace.min.js';
    document.head.append(s);
    return new Promise((ok) => { s.onload = () => ok((window as any).TraceAvatar.validate(t)); });
  }, trace);
  expect((valid as { errors: unknown[] }).errors).toEqual([]);
});
