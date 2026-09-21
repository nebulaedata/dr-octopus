/**
 * @author Codex
 * @description Exercises custom model capability editing, failed drafts and responsive keyboard access.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server;
let browser;
let baseURL;
const artifacts = join(tmpdir(), 'octopus-model-capabilities');
before(async () => {
  await mkdir(artifacts, { recursive: true });
  await build({ logLevel: 'error' });
  server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
  baseURL = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.httpServer.close(resolve) : resolve()));
});

for (const width of [1280, 390, 320]) {
  test(`capability editor saves and retains failed drafts at ${width}px`, async () => {
    const page = await browser.newPage({
      viewport: { width, height: 850 },
      locale: 'en-US',
      reducedMotion: 'reduce',
    });
    try {
      await installSessionFixture(page);
      await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
      const model = {
        modelKey: 'model-key',
        modelId: 'qwen-custom',
        name: 'qwen3.6-flash-open-custom-long-model-name',
        api: 'openai-completions',
        reasoning: false,
        input: ['text'],
        available: true,
        contextWindow: 32000,
        maxTokens: 4096,
        isDefault: false,
        configuration: 'owned',
      };
      const provider = {
        providerKey: 'provider-key',
        providerId: 'custom',
        name: 'Custom provider',
        provenance: 'models_json',
        auth: { configured: true, methods: [] },
        capabilities: { refresh: false, endpoint: 'readonly' },
        modelCount: 1,
        availableModelCount: 1,
        models: [model],
        endpoint: { effectiveBaseUrl: 'http://localhost:8000/v1' },
      };
      let failSave = true;
      const writes = [];
      await page.route('**/api/settings/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() === 'PUT') {
          const input = route.request().postDataJSON();
          writes.push(input);
          if (failSave) {
            failSave = false;
            return route.fulfill({ status: 500, json: { message: 'Test save failed' } });
          }
          Object.assign(model, input);
          return route.fulfill({ json: provider });
        }
        if (path.endsWith('/model-providers')) return route.fulfill({ json: { providers: [provider] } });
        if (path.endsWith('/provider-key')) return route.fulfill({ json: provider });
        return route.fulfill({ json: {} });
      });
      await page.goto(`${baseURL}settings/model-providers?provider=provider-key`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      const edit = page.getByRole('button', { name: 'Edit capabilities', exact: true });
      await expect(edit).toBeVisible({ timeout: 60000 });
      await edit.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const reasoning = dialog.getByRole('checkbox', { name: 'Supports reasoning' });
      await reasoning.focus();
      await page.keyboard.press('Space');
      await dialog.getByRole('checkbox', { name: 'Supports image input' }).check();
      await dialog.getByRole('button', { name: 'Save configuration' }).click();
      await expect(dialog.getByText('Test save failed')).toBeVisible();
      await expect(reasoning).toBeChecked();
      await page.screenshot({ animations: 'disabled', path: join(artifacts, `capabilities-${width}-light.png`) });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.screenshot({ animations: 'disabled', path: join(artifacts, `capabilities-${width}-dark.png`) });
      assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await dialog.getByRole('button', { name: 'Save configuration' }).click();
      await expect(dialog).not.toBeVisible();
      assert.deepEqual(writes.at(-1), { reasoning: true, input: ['text', 'image'] });
      await expect(edit).toBeFocused();
      await edit.click();
      await expect(page.getByRole('checkbox', { name: 'Supports reasoning' })).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(edit).toBeFocused();
    } finally {
      await page.close();
    }
  });
}
