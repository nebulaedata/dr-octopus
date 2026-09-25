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
        capabilities: [],
        interfaces: ['chat'],
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
          Object.assign(model, input, {
            capabilities: [
              ...(input.reasoning ? ['reasoning'] : []),
              ...(input.input.includes('image') ? ['image_input'] : []),
              ...(input.imageGeneration ? ['image_generation'] : []),
            ],
          });
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
      const reasoning = dialog.getByRole('checkbox', { name: 'Reasoning' });
      await reasoning.focus();
      await page.keyboard.press('Space');
      await dialog.getByRole('checkbox', { name: 'Image input' }).check();
      await dialog.getByRole('button', { name: 'Save configuration' }).click();
      await expect(dialog.getByText('Test save failed')).toBeVisible();
      await expect(reasoning).toBeChecked();
      await page.screenshot({
        animations: 'disabled',
        path: join(artifacts, `capabilities-${width}-light.png`),
      });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.screenshot({
        animations: 'disabled',
        path: join(artifacts, `capabilities-${width}-dark.png`),
      });
      assert.ok(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)
      );
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await dialog.getByRole('button', { name: 'Save configuration' }).click();
      await expect(dialog).not.toBeVisible();
      assert.deepEqual(writes.at(-1), { reasoning: true, input: ['text', 'image'], imageGeneration: false });
      await expect(edit).toBeFocused();
      await edit.click();
      await expect(page.getByRole('checkbox', { name: 'Reasoning' })).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(edit).toBeFocused();
    } finally {
      await page.close();
    }
  });
}

test('built-in image models show the same capability badges without an editor', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 850 }, locale: 'en-US' });
  try {
    await installSessionFixture(page);
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
    const provider = {
      providerKey: 'image-provider-key',
      providerId: 'openrouter',
      name: 'OpenRouter',
      provenance: 'builtin',
      auth: { configured: true, methods: ['api_key'] },
      capabilities: { refresh: false, endpoint: 'readonly' },
      modelCount: 1,
      availableModelCount: 1,
      models: [
        {
          modelKey: 'image-model-key',
          modelId: 'openai/gpt-image-1',
          name: 'GPT Image 1',
          api: 'openrouter-images',
          reasoning: false,
          input: ['text', 'image'],
          capabilities: ['image_input', 'image_generation'],
          interfaces: ['image'],
          available: true,
          isDefault: false,
          configuration: 'inherited',
        },
      ],
    };
    await page.route('**/api/settings/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/model-providers')) return route.fulfill({ json: { providers: [provider] } });
      if (path.endsWith('/image-provider-key')) return route.fulfill({ json: provider });
      return route.fulfill({ json: {} });
    });
    await page.goto(`${baseURL}settings/model-providers?provider=image-provider-key`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await expect(page.getByText('GPT Image 1')).toBeVisible();
    await expect(page.getByLabel('Image generation')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit capabilities' })).toHaveCount(0);
  } finally {
    await page.close();
  }
});
