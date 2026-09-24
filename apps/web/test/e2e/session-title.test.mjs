/**
 * @author Codex
 * @description Checks sidebar title truncation, hover animation and motion accessibility in the production app.
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
    directory = await mkdtemp(join(tmpdir(), 'octopus-session-title-'));
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

const longTitle =
  'A long session title with enough detail to overflow the sidebar and verify both animation endpoints';

/**
 * Opens a real sidebar row backed by deterministic network fixtures.
 */
async function openTitle(t, options = {}) {
  const { title = longTitle, ...contextOptions } = options;
  const page = await browser.newPage({
    locale: 'en',
    viewport: { width: 1280, height: 900 },
    ...contextOptions,
  });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
  const fixture = await installSessionFixture(page, { sessionTitle: title });
  await page.goto(new URL(fixture.path, baseURL).href);
  const button = page.getByRole('button').and(page.getByTitle(title, { exact: true }));
  if (options.isMobile) await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(button).toBeVisible();
  const viewport = button.locator('[data-overflow]');
  const content = viewport.locator('span[aria-hidden="true"]');
  const label = viewport.locator('span:not([aria-hidden])');
  t.after(() => assert.deepEqual(errors, []));
  return { page, button, viewport, content, label };
}

for (const colorScheme of ['light', 'dark']) {
  test(
    'long sidebar title retains hover travel and endpoint pauses in ' + colorScheme,
    { timeout: 60000 },
    async (t) => {
      const { page, button, viewport, content, label } = await openTitle(t, { colorScheme });
      await expect(viewport).toHaveAttribute('data-overflow', 'true');
      await page.mouse.move(1200, 0);
      await expect(content).toHaveCSS('visibility', 'hidden');
      await expect(viewport).toHaveCSS('text-overflow', 'ellipsis');
      await button.hover();
      await expect(content).toHaveCSS('visibility', 'visible');
      await expect(label).toHaveCSS('opacity', '0');
      await expect(viewport).toHaveCSS('text-overflow', 'clip');
      const animation = await content.evaluate((element) => {
        const effect = element.getAnimations()[0].effect;
        const timing = effect.getTiming();
        return {
          delay: timing.delay,
          duration: timing.duration,
          easing: timing.easing,
          infinite: timing.iterations === Infinity,
          frames: effect
            .getKeyframes()
            .map((frame) => ({ offset: frame.offset, transform: frame.transform })),
        };
      });
      assert.equal(animation.delay, 300);
      assert.equal(animation.easing, 'linear');
      assert.equal(animation.infinite, true);
      assert.ok(animation.duration >= 4000);
      assert.deepEqual(
        animation.frames.map((frame) => frame.offset),
        [0, 0.45, 0.5, 0.95, 1]
      );
      assert.equal(animation.frames[0].transform, animation.frames[3].transform);
      assert.equal(animation.frames[3].transform, animation.frames[4].transform);
      assert.equal(animation.frames[1].transform, animation.frames[2].transform);
      assert.notEqual(animation.frames[0].transform, animation.frames[1].transform);
      await page.mouse.move(1200, 0);
      await expect(content).toHaveCSS('visibility', 'hidden');
      await expect(content).toHaveCSS('animation-name', 'none');
      await expect(label).toHaveCSS('opacity', '1');
    }
  );
}

test('short sidebar titles stay static on hover', { timeout: 60000 }, async (t) => {
  const { button, viewport, content, label } = await openTitle(t, { title: 'Short' });
  await expect(viewport).toHaveAttribute('data-overflow', 'false');
  await button.hover();
  await expect(content).toHaveCSS('visibility', 'hidden');
  await expect(content).toHaveCSS('animation-name', 'none');
  await expect(label).toHaveCSS('opacity', '1');
});

for (const options of [
  { reducedMotion: 'reduce' },
  { isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } },
  { isMobile: true, hasTouch: true, viewport: { width: 320, height: 700 } },
]) {
  test(
    'long titles remain readable without hover animation: ' + JSON.stringify(options),
    { timeout: 60000 },
    async (t) => {
      const { button, viewport, content, label } = await openTitle(t, options);
      await expect(viewport).toHaveAttribute('data-overflow', 'true');
      await button.hover();
      await expect(viewport).toHaveCSS('text-overflow', 'ellipsis');
      await expect(content).toHaveCSS('visibility', 'hidden');
      await expect(content).toHaveCSS('animation-name', 'none');
      await expect(label).toHaveCSS('opacity', '1');
    }
  );
}
