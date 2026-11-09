/**
 * "Save as video" in each browser. The tab share is faked (a canvas stream that paints the #app area green
 * while the guide plays, blue while it waits, and everything else red), so the crop and the cuts can be read
 * back from the GIF's pixels. One Chromium test uses the real tab capture.
 */
import { test, expect, chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import omggif from 'omggif';

const URL_ = '/tests/e2e/fixtures/export.html';

/** Replace getDisplayMedia with a painted canvas stream (2× the viewport, like a hi-dpi tab). */
async function fakeShare(page: Page, how: 'ok' | 'deny' = 'ok', area = '#app') {
  await page.addInitScript(([how, area]) => {
    const md = (navigator.mediaDevices ?? {}) as MediaDevices;
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
    (md as unknown as Record<string, unknown>).getDisplayMedia = async () => {
      if (how === 'deny') throw new DOMException('Permission denied', 'NotAllowedError');
      const cv = document.createElement('canvas');
      cv.width = innerWidth * 2;
      cv.height = innerHeight * 2;
      cv.style.cssText = 'position:fixed;left:-99999px;top:0';
      document.body.append(cv);
      const g = cv.getContext('2d')!;
      const w = window as unknown as { __phase: string; __shares: number };
      w.__shares = (w.__shares ?? 0) + 1;
      const paint = () => {
        g.fillStyle = '#ff0000';
        g.fillRect(0, 0, cv.width, cv.height);
        const r = document.querySelector(area)!.getBoundingClientRect();
        g.fillStyle = w.__phase === 'waiting' ? '#0000ff' : '#00ff00';
        g.fillRect(r.x * 2, r.y * 2, r.width * 2, r.height * 2);
      };
      paint();
      setInterval(paint, 10);
      const s = (cv as HTMLCanvasElement & { captureStream(f: number): MediaStream }).captureStream(30);
      (window as unknown as { __stream: MediaStream }).__stream = s;
      return s;
    };
  }, [how, area] as const);
}

function gifFrames(b64: string) {
  const g = new omggif.GifReader(new Uint8Array(Buffer.from(b64, 'base64')));
  const canvas = new Uint8Array(g.width * g.height * 4);
  const list: Array<{ ms: number; red: number; blue: number; green: number }> = [];
  for (let i = 0; i < g.numFrames(); i += 1) {
    g.decodeAndBlitFrameRGBA(i, canvas);
    let red = 0; let blue = 0; let green = 0;
    for (let p = 0; p < g.width * g.height; p += 1) {
      const [r, gg, b] = [canvas[p * 4], canvas[p * 4 + 1], canvas[p * 4 + 2]];
      if (r > 200 && gg < 60 && b < 60) red += 1;
      else if (b > 200 && r < 60 && gg < 60) blue += 1;
      else if (gg > 200 && r < 60 && b < 60) green += 1;
    }
    list.push({ ms: g.frameInfo(i).delay * 10, red, blue, green });
  }
  return { width: g.width, height: g.height, list, total: list.reduce((a, f) => a + f.ms, 0) };
}

test.describe('Save as video', () => {
  test('GIF: cropped to the area, scaled, the long wait cut to 0.8 s, named from the title', async ({ page }) => {
    await fakeShare(page);
    await page.goto(URL_);
    const r = await page.evaluate(() => (window as unknown as { __save(o?: object): Promise<Record<string, unknown>> }).__save({ format: 'gif' }));
    expect(r.error, String(r.message)).toBeUndefined();
    expect(r).toMatchObject({ type: 'image/gif', filename: 'wait-then-save.gif' });
    const gif = gifFrames(r.b64 as string);
    // The area is 400×300 CSS px, 800×600 in the 2× share: 800 wide is the default.
    expect([gif.width, gif.height]).toEqual([800, 600]);
    expect(Math.abs(gif.total - (r.durationMs as number))).toBeLessThanOrEqual(100);
    // Nothing outside the area (red) is in any frame.
    expect(Math.max(...gif.list.map((f) => f.red))).toBeLessThan(800 * 2);
    // The 3 s wait (blue) shows for about 0.8 s; the guide played (green) before and after it.
    const blueMs = gif.list.filter((f) => f.blue > f.green).reduce((a, f) => a + f.ms, 0);
    expect(blueMs).toBeGreaterThan(400);
    expect(blueMs).toBeLessThan(1500);
    expect(gif.total).toBeLessThan(3000 + 500 + 1500 + 1500);
    // Sharing stopped.
    expect(await page.evaluate(() => (window as unknown as { __stream: MediaStream }).__stream.getTracks().every((t) => t.readyState === 'ended'))).toBe(true);
  });

  test('video: a WebM (or MP4) where the browser records', async ({ page }) => {
    await fakeShare(page);
    await page.goto(URL_);
    const can = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && ['video/webm', 'video/mp4'].some((t) => MediaRecorder.isTypeSupported(t)));
    const r = await page.evaluate(() => (window as unknown as { __save(o?: object): Promise<Record<string, unknown>> }).__save({ format: 'video' }));
    if (!can) { expect(r.error).toBe('unsupported'); return; }
    expect(r.error, String(r.message)).toBeUndefined();
    expect(String(r.type)).toMatch(/^video\/(webm|mp4)/);
    expect(r.filename).toMatch(/^wait-then-save\.(webm|mp4)$/);
    expect(r.size as number).toBeGreaterThan(1000);
    expect(r.durationMs as number).toBeLessThan(6500);
  });

  test('a refused share, and sharing stopped midway, reject with reasons', async ({ page }) => {
    await fakeShare(page, 'deny');
    await page.goto(URL_);
    const denied = await page.evaluate(() => (window as unknown as { __save(): Promise<Record<string, unknown>> }).__save());
    expect(denied).toMatchObject({ error: 'denied', name: 'ExportError' });

    const p2 = await page.context().newPage();
    await fakeShare(p2);
    await p2.goto(URL_);
    const r = await p2.evaluate(async () => {
      const w = window as unknown as { __save(): Promise<Record<string, unknown>>; __stream: MediaStream; __phase: string };
      const done = w.__save();
      while (w.__phase !== 'waiting') await new Promise((res) => setTimeout(res, 50));
      const t = w.__stream.getVideoTracks()[0];
      t.stop();
      t.dispatchEvent(new Event('ended')); // what the browser fires when the viewer clicks "Stop sharing"
      return done;
    });
    expect(r).toMatchObject({ error: 'cancelled' });
    expect(await p2.evaluate(() => (window as unknown as { __phase: string }).__phase)).not.toBe('playing');
  });
});

test('the playground: Save as video downloads a GIF of the app, with progress', async ({ page }) => {
  await fakeShare(page, 'ok', '.app');
  await page.goto('/playground/');
  await expect(page.locator('#json')).not.toHaveValue('');
  const saw: string[] = [];
  const watch = setInterval(() => { void page.locator('#status').textContent().then((t) => { if (t) saw.push(t); }).catch(() => {}); }, 200);
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.click('#save-video');
  const d = await download;
  clearInterval(watch);
  expect(d.suggestedFilename()).toMatch(/\.gif$/);
  await expect(page.locator('#status')).toContainText(/Saved .*\.gif \(\d+\.\d s, \d+ KB\)/);
  expect(saw.some((t) => t.startsWith('Recording…'))).toBe(true);
  await expect(page.locator('#save-video')).toBeEnabled();
});

test('real tab capture (Chromium)', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'tab capture without a prompt is a Chromium switch');
  // The new headless mode (channel 'chromium') can capture its own tab; the old headless shell can't.
  const browser = await chromium.launch({ channel: 'chromium', args: ['--auto-accept-this-tab-capture'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://127.0.0.1:4173${URL_}`);
    const r = await page.evaluate(() => (window as unknown as { __save(o?: object): Promise<Record<string, unknown>> }).__save({ format: 'gif', width: 400 }));
    test.skip(r.error === 'denied' || r.error === 'unsupported' || (r.error === 'failed' && /share/.test(String(r.message))), `this Chromium can't capture its own tab headless: ${r.message}`);
    expect(r.error, String(r.message)).toBeUndefined();
    const gif = gifFrames(r.b64 as string);
    expect(gif.width).toBe(400);
    expect(gif.height).toBe(300);
    expect(gif.total).toBeGreaterThan(1500);
    // The real page: the avatar's colour (#ff00aa, its badge and the click ring) shows up.
    const g = new omggif.GifReader(new Uint8Array(Buffer.from(r.b64 as string, 'base64')));
    const px = new Uint8Array(g.width * g.height * 4);
    let pink = 0;
    for (let i = 0; i < g.numFrames(); i += 1) {
      g.decodeAndBlitFrameRGBA(i, px);
      for (let p = 0; p < g.width * g.height; p += 1) if (px[p * 4] > 220 && px[p * 4 + 1] < 60 && px[p * 4 + 2] > 140 && px[p * 4 + 2] < 200) pink += 1;
    }
    expect(pink).toBeGreaterThan(50);
  } finally { await browser.close(); }
});
