/**
 * @author Codex
 * @description Verifies keyboard Session navigation reveals active rows in an overflowing sidebar.
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
    const outDir = 'node_modules/.playwright-session-scroll-build';
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

for (const direction of ['previous', 'next']) {
  test(`${direction} session shortcut reveals an offscreen active row without taking focus`, async (t) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    t.after(() => page.close());
    await installSessionFixture(page);
    const sessions = Array.from({ length: 40 }, (_, index) => ({
      id: `filler-${index}`,
      workspaceId: 'workspace-e2e',
      title: `Session ${index}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preferences: { steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time' },
    }));
    sessions[direction === 'previous' ? 39 : 0].id = 'session-e2e';
    await page.route('**/api/workspaces/workspace-e2e/sessions', (route) =>
      route.fulfill({ json: sessions })
    );
    await page.route('**/api/**/session-drafts', (route) =>
      route.fulfill({ status: 503, json: { message: 'Runtime unavailable' } })
    );
    await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
    const rows = page.locator('[data-slot="scroll-area-viewport"] [data-active]');
    await expect(rows).toHaveCount(40);
    const viewport = page
      .locator('[data-slot="scroll-area-viewport"]')
      .filter({ has: page.locator('[data-active]') });
    await viewport.evaluate((element, direction) => {
      element.scrollTop = direction === 'previous' ? 0 : element.scrollHeight;
    }, direction);
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await editor.focus();
    await page.keyboard.press(direction === 'previous' ? 'Control+[' : 'Control+]');
    await expect(page).toHaveURL(/sessions\/session-e2e/);
    const active = rows.and(page.locator('[data-active="true"]'));
    await expect(active).toHaveCount(1);
    await expect
      .poll(async () => {
        const row = await active.boundingBox();
        const area = await viewport.boundingBox();
        return (
          row !== null &&
          area !== null &&
          row.y >= area.y - 1 &&
          row.y + row.height <= area.y + area.height + 1
        );
      })
      .toBe(true);
    await expect(active.locator('button').first()).not.toBeFocused();
    await page.screenshot({ path: `.playwright-artifacts/session-scroll-${direction}.png` });
  });
}
