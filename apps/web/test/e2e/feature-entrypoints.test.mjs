/**
 * @author Codex
 * @description Verifies public feature entrypoints defer route implementations and retain concrete React page components.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let browser, server, baseURL, directory;
before(async () => {
  baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) {
    directory = await mkdtemp(join(tmpdir(), 'octopus-feature-entries-'));
    await build({ logLevel: 'error', build: { outDir: directory, emptyOutDir: false } });
    server = await preview({ build: { outDir: directory }, preview: { host: '127.0.0.1', port: 0 } });
    baseURL = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test(
  'home and Session use concrete public components while the transcript remains deferred',
  { timeout: 60000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'en', viewport: { width: 1280, height: 900 } });
    t.after(() => page.close());
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => requests.push(request.url()));
    const fixture = await installSessionFixture(page);
    await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
    await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toBeEditable();
    assert.ok(
      !requests.some((url) => /\/WorkbenchSessionPage-[^/]+\.js/.test(url)),
      'home must not fetch the transcript page implementation'
    );
    await page.goto(new URL(fixture.path, baseURL).href);
    await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toBeEditable();
    await page.getByRole('textbox', { name: 'Message Dr.Octopus' }).fill('entrypoint draft');
    await page.getByRole('button').first().focus();
    await page.keyboard.press('Alt+i');
    await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toHaveText('entrypoint draft');
    assert.ok(
      requests.some((url) => /\/WorkbenchSessionPage-[^/]+\.js/.test(url)),
      'Session navigation must load the deferred implementation'
    );
    assert.deepEqual(errors, []);
  }
);
