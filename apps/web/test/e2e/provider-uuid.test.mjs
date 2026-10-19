/**
 * @author Codex
 * @description Verifies provider creation in a real insecure HTTP browser context without native randomUUID.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { validate, version } from 'uuid';
import { installSessionFixture } from './session-fixture.mjs';

let browser;
let server;
let baseURL;
const artifacts = join(tmpdir(), 'octopus-provider-uuid-qa');
before(async () => {
  await mkdir(artifacts, { recursive: true });
  await build({ logLevel: 'error' });
  server = await preview({
    preview: { host: '127.0.0.1', port: 0, open: false, allowedHosts: ['octopus-uuid.test'] },
  });
  const address = new URL(server.resolvedUrls.local[0]);
  address.hostname = 'octopus-uuid.test';
  baseURL = address.href;
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    args: ['--host-resolver-rules=MAP octopus-uuid.test 127.0.0.1', '--no-proxy-server'],
  });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
});

for (const width of [1280, 390]) {
  test(`provider creation succeeds over insecure HTTP at ${width}px`, async (t) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'en-US' });
    t.after(() => page.close());
    await installSessionFixture(page);
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    const writes = [];
    const provider = {
      providerKey: 'uuid-provider',
      providerId: 'uuid-provider',
      name: 'Mr.Token HTTP test',
      provenance: 'models_json',
      auth: { configured: false, methods: [] },
      capabilities: { refresh: false, endpoint: 'readonly' },
      modelCount: 0,
      availableModelCount: 0,
      models: [],
      local: { runtime: 'mr-token', baseUrl: 'https://example.com/v1' },
    };
    await page.route('**/api/settings/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/local-runtimes')) {
        return route.fulfill({
          json: [{ id: 'mr-token', name: 'Mr.Token', defaultBaseUrl: 'https://example.com/v1' }],
        });
      }
      if (path.endsWith('/local-providers') && request.method() === 'POST') {
        writes.push({ input: request.postDataJSON(), key: request.headers()['idempotency-key'] });
        return route.fulfill({ json: provider });
      }
      if (path.endsWith('/model-providers')) {
        return route.fulfill({ json: { providers: writes.length ? [provider] : [] } });
      }
      if (path.endsWith('/uuid-provider')) {
        return route.fulfill({ json: provider });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto(new URL('settings/model-providers', baseURL).href);
    assert.equal(new URL(page.url()).hostname, 'octopus-uuid.test');
    assert.ok(await page.title());
    assert.deepEqual(
      await page.evaluate(() => ({
        secure: globalThis.isSecureContext,
        randomUUID: typeof globalThis.crypto.randomUUID,
        getRandomValues: typeof globalThis.crypto.getRandomValues,
      })),
      { secure: false, randomUUID: 'undefined', getRandomValues: 'function' }
    );
    await page.getByRole('button', { name: 'Model provider', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Provider name' }).fill(provider.name);
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Mr.Token', exact: true }).click();
    await page.screenshot({ path: join(artifacts, `provider-before-${width}.png`) });
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/provider=uuid-provider/);
    await expect(page.getByRole('heading', { name: provider.name, exact: true })).toBeVisible();
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].input, { name: provider.name, runtime: 'mr-token' });
    assert.ok(validate(writes[0].key));
    assert.equal(version(writes[0].key), 4);
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    await page.screenshot({ path: join(artifacts, `provider-after-${width}.png`) });
  });
}
