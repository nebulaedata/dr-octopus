/**
 * @author Codex
 * @description Exercises relay model association editing, failed drafts and responsive keyboard access.
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
const artifacts = join(tmpdir(), 'octopus-model-associations');
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
  test(`relay association retains failed drafts at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 850 }, locale: 'en-US' });
    try {
      await installSessionFixture(page);
      await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
      const source = { providerId: 'deepseek', modelId: 'deepseek-chat' };
      const model = {
        modelKey: 'model-key',
        modelId: 'alias',
        name: 'Relay alias',
        api: 'openai-completions',
        reasoning: false,
        input: ['text'],
        capabilities: [],
        available: false,
        isDefault: false,
        configuration: 'owned',
        association: null,
        adaptation: { status: 'unadapted', reason: 'not_found' },
      };
      const provider = {
        providerKey: 'provider-key',
        providerId: 'custom',
        name: 'Mr.Token',
        provenance: 'models_json',
        auth: { configured: true, methods: [] },
        capabilities: { refresh: false, endpoint: 'readonly' },
        modelCount: 1,
        availableModelCount: 0,
        models: [model],
        local: { runtime: 'mr-token', endpoint: 'http://localhost:8000/v1' },
      };
      let failSave = true;
      const writes = [];
      await page.route('**/api/settings/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/association') && route.request().method() === 'PUT') {
          const input = route.request().postDataJSON();
          writes.push(input);
          if (failSave) {
            failSave = false;
            return route.fulfill({ status: 500, json: { message: 'Test save failed' } });
          }
          model.association = input.source;
          model.available = Boolean(input.source);
          model.adaptation = input.source
            ? { status: 'adapted', source: { ...source, api: model.api } }
            : { status: 'unadapted', reason: 'not_found' };
          return route.fulfill({ json: provider });
        }
        if (path.endsWith('/associations'))
          return route.fulfill({ json: { candidates: [{ ...source, name: 'DeepSeek', api: model.api }] } });
        if (path.endsWith('/model-providers')) return route.fulfill({ json: { providers: [provider] } });
        if (path.endsWith('/provider-key')) return route.fulfill({ json: provider });
        return route.fulfill({ json: {} });
      });
      await page.goto(`${baseURL}settings/model-providers?provider=provider-key`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      const edit = page.getByRole('button', { name: 'Edit model association', exact: true });
      await edit.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('checkbox')).toHaveCount(0);
      await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
      const select = dialog.getByRole('combobox', { name: 'Original model' });
      await select.fill('deepseek');
      await select.press('ArrowDown');
      await page.getByRole('option', { name: 'deepseek / deepseek-chat', exact: true }).click();
      await dialog.getByRole('button', { name: 'Save association' }).click();
      await expect(dialog.getByText('Test save failed')).toBeVisible();
      await expect(select).toHaveValue('deepseek / deepseek-chat');
      await dialog.getByRole('button', { name: 'Save association' }).click();
      await expect(dialog).not.toBeVisible();
      assert.deepEqual(writes.at(-1), { source });
      await edit.click();
      await select.fill('Automatic');
      await select.press('ArrowDown');
      await page.getByRole('option', { name: 'Automatic matching', exact: true }).click();
      await dialog.getByRole('button', { name: 'Save association' }).click();
      await expect(dialog).not.toBeVisible();
      assert.deepEqual(writes.at(-1), { source: null });
      assert.ok(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)
      );
    } finally {
      await page.close();
    }
  });
}
