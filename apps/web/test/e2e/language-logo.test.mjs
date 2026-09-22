/**
 * @author Codex
 * @description Verifies persisted language selection and SVG playback across pointer and media-query variants.
 */
import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server;
let browser;
let baseURL;
before(async () => {
  baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) {
    const outDir = 'node_modules/.playwright-preferences-build';
    await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
    server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } });
    baseURL = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: process.env.E2E_HEADED !== '1',
  });
  await mkdir('.playwright-artifacts', { recursive: true });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
});

/**
 * Opens the real application with isolated storage and mocked server boundaries.
 */
async function openPage(t, options = {}) {
  const page = await browser.newPage({ locale: 'en-US', ...options });
  t.after(() => page.close());
  await installSessionFixture(page);
  await page.route('**/api/**/session-drafts', (route) =>
    route.fulfill({ status: 503, json: { message: 'Runtime unavailable' } })
  );
  return page;
}

test('language selection survives actual browser reload in both directions', async (t) => {
  const page = await openPage(t);
  await page.goto(new URL('/settings/appearance/language', baseURL).href);
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await page.reload();
  await expect(page.getByText('显示语言', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Display language', { exact: true })).toBeVisible();
});

test('idle SVG floats and resumes after mouse leave regardless of system motion preferences', async (t) => {
  const page = await openPage(t);
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const logo = page.getByRole('button', { name: 'Dr.Octopus, click to splash', exact: true });
  await expect(logo).toBeVisible();
  const initial = await logo.evaluate((svg) => svg.getCurrentTime());
  await expect.poll(() => logo.evaluate((svg) => svg.getCurrentTime())).toBeGreaterThan(initial + 0.1);
  const initialTransform = await logo.locator('image').evaluate((image) => image.getCTM().f);
  await expect
    .poll(() => logo.locator('image').evaluate((image) => image.getCTM().f))
    .not.toBe(initialTransform);
  await logo.hover();
  await expect.poll(() => logo.evaluate((svg) => svg.animationsPaused())).toBe(true);
  await page.mouse.move(0, 0);
  await expect.poll(() => logo.evaluate((svg) => svg.animationsPaused())).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => logo.evaluate((svg) => svg.animationsPaused())).toBe(false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => logo.evaluate((svg) => svg.animationsPaused())).toBe(false);
  await page.screenshot({ path: '.playwright-artifacts/logo-playback.png' });
});

test('reduced motion at startup preserves floating, splash and typing reactions on touch devices', async (t) => {
  const page = await openPage(t, { hasTouch: true, viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const logo = page.getByRole('button', { name: 'Dr.Octopus, click to splash', exact: true });
  await expect(logo).toBeVisible();
  const image = logo.locator('image');
  const initialTransform = await image.evaluate((element) => element.getCTM().f);
  await expect.poll(() => image.evaluate((element) => element.getCTM().f)).not.toBe(initialTransform);
  await logo.tap();
  const reaction = logo.locator('animateTransform[dur="1.6s"]').first();
  await expect(reaction).toBeAttached();
  await expect(reaction).not.toBeAttached();
  await page.getByRole('textbox', { name: 'Message Dr.Octopus' }).press('a');
  await expect(logo.locator('animateTransform[dur="0.72s"]').first()).toBeAttached();
  await logo.dispatchEvent('pointerenter', { pointerType: 'touch' });
  await expect.poll(() => logo.evaluate((svg) => svg.animationsPaused())).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => logo.evaluate((svg) => svg.animationsPaused())).toBe(false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => logo.evaluate((svg) => svg.animationsPaused())).toBe(false);
  await page.screenshot({ path: '.playwright-artifacts/logo-touch.png' });
  if (errors.length) throw new Error(errors.join('\n'));
});
