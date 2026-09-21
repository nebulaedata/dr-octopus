/**
 * @author Codex
 * @description Verifies Composer focus through real keyboard events during warmup, drafting and shortcut customization.
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
    const outDir = 'node_modules/.playwright-focus-build';
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
 * Opens an isolated browser context with deterministic Session boundaries.
 */
async function openSession(t) {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
  const fixture = await installSessionFixture(page);
  return { page, path: fixture.path };
}

test('Alt+I focuses the editable Composer while home runtime is unavailable', async (t) => {
  const { page } = await openSession(t);
  await page.route('**/api/**/session-drafts', (route) =>
    route.fulfill({ status: 503, json: { message: 'Runtime unavailable' } })
  );
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await expect(editor).toBeEditable();
  await page.getByRole('button').first().focus();
  await page.keyboard.press('Alt+i');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Warmup draft');
  await expect(editor).toHaveText('Warmup draft');
  await page.screenshot({ path: '.playwright-artifacts/composer-focus-warmup.png' });
});

test('Alt+I refocuses without changing the existing draft', async (t) => {
  const { page, path } = await openSession(t);
  await page.goto(new URL(path, baseURL).href);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await expect(editor).toBeEditable();
  await page.getByRole('button').first().focus();
  await page.keyboard.press('Alt+i');
  await expect(editor).toBeFocused();
  await page.keyboard.type('draft');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button').first().focus();
  await page.keyboard.press('Alt+i');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('draft');
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await expect(editor).toHaveText('draftX');
  await page.screenshot({ path: '.playwright-artifacts/composer-focus-caret.png' });
});

test('custom focus binding persists and clearing it disables focus', async (t) => {
  const { page, path } = await openSession(t);
  await page.goto(new URL('/settings/appearance/shortcuts', baseURL).href);
  const row = page.getByRole('row').filter({ hasText: 'Focus composer' });
  await row.getByRole('button', { name: 'Edit shortcut', exact: true }).click();
  await page.keyboard.press('Control+Shift+y');
  await expect(row).toContainText('Ctrl');
  await page.goto(new URL(path, baseURL).href);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await expect(editor).toBeEditable();
  await page.getByRole('button').first().focus();
  await page.keyboard.press('Alt+i');
  await expect(editor).not.toBeFocused();
  await page.keyboard.press('Control+Shift+y');
  await expect(editor).toBeFocused();
  await page.goto(new URL('/settings/appearance/shortcuts', baseURL).href);
  await row.getByRole('button', { name: 'Clear shortcut', exact: true }).click();
  await expect(row).toContainText('Not set');
  await page.goto(new URL(path, baseURL).href);
  await expect(editor).toBeEditable();
  await page.getByRole('button').first().focus();
  await page.keyboard.press('Control+Shift+y');
  await expect(editor).not.toBeFocused();
});
