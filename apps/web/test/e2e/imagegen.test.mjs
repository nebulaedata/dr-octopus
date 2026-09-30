/**
 * @author Codex
 * @description Checks image model selection and durable previews with isolated browser network fixtures.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
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
  await server?.close();
});

test(
  'restored image receipts render previews, downloads and missing-file states',
  { timeout: 180000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 960 } });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const receipt = {
      version: 1,
      providerId: 'openai',
      modelId: 'image-fixture',
      images: [
        {
          path: '/workspace/generated-images/a.png',
          relativePath: 'generated-images/a.png',
          mimeType: 'image/png',
          width: 512,
          height: 512,
        },
      ],
    };
    await installSessionFixture(page, {
      initialMessages: [
        {
          id: 'assistant-image',
          role: 'assistant',
          timestamp: 1767225600000,
          content: [
            {
              type: 'toolCall',
              id: 'image-call',
              name: 'image_generate',
              arguments: { prompt: 'A red square' },
            },
          ],
        },
        {
          id: 'result-image',
          role: 'toolResult',
          toolCallId: 'image-call',
          toolName: 'image_generate',
          content: [{ type: 'text', text: 'generated-images/a.png' }],
          details: receipt,
          isError: false,
          timestamp: 1767225601000,
        },
      ],
    });
    let missing = false;
    const preview = await readFile(new URL('../../public/brand/logo-512.png', import.meta.url));
    await page.route('**/api/workspaces/*/files/image?*', (route) =>
      missing ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/png', body: preview })
    );
    await page.goto(`${baseURL}workspaces/workspace-e2e/sessions/session-e2e`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    const trigger = page.getByRole('button', { name: /image_generate/ });
    await expect(trigger).toBeVisible({ timeout: 120000 });
    await trigger.click();
    await expect(page.getByRole('img', { name: 'Generated image', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'Generated image', exact: true })
          .evaluate((element) => element.naturalWidth)
      )
      .toBe(512);
    const previewLink = page.getByRole('link', { name: 'Open full-size image' });
    const cover = previewLink.locator('img').first();
    const contain = previewLink.locator('img').last();
    await page.mouse.move(0, 0);
    await expect(cover).toHaveCSS('opacity', '1');
    const previewBounds = await previewLink.boundingBox();
    await previewLink.hover();
    await expect(contain).toHaveCSS('opacity', '1');
    await expect(cover).toHaveCSS('opacity', '0');
    const hoveredBounds = await previewLink.boundingBox();
    assert.equal(hoveredBounds.width, previewBounds.width);
    assert.equal(hoveredBounds.height, previewBounds.height);
    await page.mouse.move(0, 0);
    await expect(cover).toHaveCSS('opacity', '1');
    await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute(
      'href',
      /files\/download\?path=generated-images/
    );
    await page.screenshot({ path: '.playwright-artifacts/imagegen-receipt-desktop.png', fullPage: true });
    const filePath = page.getByText('File path', { exact: true });
    await filePath.click();
    await expect(page.locator('figure').getByText('generated-images/a.png', { exact: true })).toBeVisible();
    await filePath.click();
    await expect(page.getByRole('link', { name: 'Open full-size image' })).toHaveAttribute(
      'target',
      '_blank'
    );
    await page.evaluate(() => globalThis.document.documentElement.classList.add('dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
    await page.screenshot({ path: '.playwright-artifacts/imagegen-receipt-mobile-dark.png', fullPage: true });
    await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)
      );
    }
    missing = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(
      page.getByText('This image is missing or cannot be previewed.', { exact: true })
    ).toBeVisible();
    assert.deepEqual(errors, []);
  }
);

test(
  'independent image settings keep service drafts and do not change chat defaults',
  { timeout: 180000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 960 } });
    t.after(() => page.close());
    await installSessionFixture(page);
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
    let config = {
      enabled: false,
      activeProvider: 'openai',
      revision: 'initial',
      providers: {
        openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1.5', hasApiKey: false },
        qwen: {
          baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
          model: 'qwen-image-3.0-pro',
          hasApiKey: false,
        },
      },
    };
    const writes = [];
    await page.route('**/api/settings/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/settings/imagegen') {
        if (request.method() === 'PUT') {
          const change = request.postDataJSON();
          writes.push(change);
          if (change.provider) {
            const { id, apiKey, ...fields } = change.provider;
            config.providers[id] = {
              ...fields,
              hasApiKey: apiKey === undefined ? config.providers[id].hasApiKey : Boolean(apiKey),
            };
          }
          config = {
            ...config,
            activeProvider: change.activeProvider ?? config.activeProvider,
            enabled: change.enabled ?? config.enabled,
            revision: String(writes.length),
          };
        }
        return route.fulfill({ json: config });
      }
      if (path.endsWith('/default-model/candidates')) return route.fulfill({ json: { candidates: [] } });
      if (path.endsWith('/default-model'))
        return route.fulfill({ json: { configured: false, available: false, effect: 'new_sessions' } });
      return route.fulfill({ json: {} });
    });
    await page.goto(`${baseURL}settings/imagegen`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('tab', { name: 'Qwen Bailian' }).click();
    await page.getByRole('textbox', { name: 'Image model', exact: true }).fill('qwen-image-3.0');
    await page.getByRole('tab', { name: 'OpenAI', exact: true }).click();
    await page.getByRole('tab', { name: 'Qwen Bailian' }).click();
    await expect(page.getByRole('textbox', { name: 'Image model', exact: true })).toHaveValue(
      'qwen-image-3.0'
    );
    assert.equal(config.activeProvider, 'openai');
    await page.getByRole('button', { name: 'Save and use', exact: true }).click();
    await expect(page.getByText('Image settings saved.')).toBeVisible();
    assert.equal(config.activeProvider, 'qwen');
    assert.equal(writes.at(-1).provider.model, 'qwen-image-3.0');
    assert.equal(writes.at(-1).provider.apiKey, undefined);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)
      );
    }
    await page.goto(`${baseURL}settings/default-model`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('textbox', { name: 'Image model', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Qwen Bailian' })).toHaveCount(0);
  }
);
