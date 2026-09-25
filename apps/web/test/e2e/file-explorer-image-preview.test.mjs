/**
 * @author Codex
 * @description Verifies long file names and interactive image previews in the real file explorer.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server;
let browser;
let baseURL;

before(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  await server.listen();
  baseURL = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await mkdir('.playwright-artifacts', { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.httpServer?.closeAllConnections();
  await server?.close();
});

test(
  'file tree exposes complete names and previews images with zoom, rotation, and panning',
  { timeout: 120000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
    const fixture = await installSessionFixture(page);
    const imageName = 'an-image-with-a-long-descriptive-name-that-overflows-the-file-tree.png';
    const folderName = 'a-folder-with-a-long-descriptive-name-that-overflows-the-file-tree';
    const image = await readFile(new URL('../../public/brand/logo-512.png', import.meta.url));
    await page.route('**/api/workspaces/workspace-e2e/files?*', (route) =>
      route.fulfill({
        json: {
          entries: [
            { name: imageName, path: imageName, type: 'file' },
            { name: folderName, path: folderName, type: 'directory' },
          ],
        },
      })
    );
    await page.route('**/api/workspaces/workspace-e2e/files/image?*', (route) =>
      route.fulfill({ contentType: 'image/png', body: image })
    );

    await page.goto(new URL(fixture.path, baseURL).href, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const file = page.getByRole('button', { name: imageName });
    const folder = page.getByRole('button', { name: folderName });
    await expect(file).toHaveAttribute('title', imageName);
    await expect(folder).toHaveAttribute('title', folderName);

    await file.dblclick();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: imageName })).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: '.playwright-artifacts/file-explorer-image-preview-desktop.png' });
    await dialog.getByRole('button', { name: 'Zoom in' }).click();
    await expect(dialog.getByText('125%')).toBeVisible();
    await dialog.getByRole('button', { name: 'Rotate right' }).click();
    await expect(dialog.getByRole('img', { name: imageName })).toHaveCSS('transform', /matrix\(0, 1/);
    await dialog.getByRole('img', { name: imageName }).hover();
    await page.mouse.wheel(0, 500);
    await expect(dialog.getByText('100%')).toBeVisible();
    await dialog.getByRole('button', { name: 'Reset image view' }).click();
    await expect(dialog.getByRole('img', { name: imageName })).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)'
    );
    const zoomIn = dialog.getByRole('button', { name: 'Zoom in' });
    for (let step = 0; step < 4; step += 1) {
      await zoomIn.click();
    }
    await expect(dialog.getByText('200%')).toBeVisible();
    await expect(dialog.getByText('Drag to move')).toBeVisible();
    const previewImage = dialog.getByRole('img', { name: imageName });
    await expect(previewImage).toHaveCSS('transform', 'matrix(2, 0, 0, 2, 0, 0)');
    const beforeDrag = await previewImage.boundingBox();
    const viewport = await previewImage.locator('..').boundingBox();
    assert.ok(beforeDrag && viewport);
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY + 100, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await previewImage.boundingBox())?.y).toBeGreaterThan(beforeDrag.y + 60);
    await dialog.getByRole('button', { name: 'Reset image view' }).click();
    await expect(previewImage).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await page.evaluate(() => globalThis.document.documentElement.classList.add('dark'));
    await expect(dialog.getByRole('button', { name: 'Reset image view' })).toBeVisible();
    await page.screenshot({ path: '.playwright-artifacts/file-explorer-image-preview-dark.png' });
    assert.deepEqual(errors, []);
  }
);
