/**
 * @author Codex
 * @description Verifies Jev default-off settings, environment credentials and saved configuration in an isolated browser.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server, browser, baseURL, outDir;
before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'octopus-jev-browser-'));
  if (process.env.E2E_BASE_URL) baseURL = process.env.E2E_BASE_URL;
  else {
    await build({ logLevel: 'error', build: { outDir, emptyOutDir: false } });
    server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } });
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
  await rm(outDir, { recursive: true, force: true });
});

/**
 * Intercept every Jev mutation so tests cannot alter user configuration or call the provider.
 */
async function fixture(page, hasApiKey) {
  await installSessionFixture(page);
  let settings = {
    revision: 'r0',
    model: 'jev-1.13.0',
    hasApiKey,
    hasStoredApiKey: hasApiKey,
    apiKeyOverridden: false,
    environmentRevision: 'e0',
  };
  const writes = [];
  let keyWrites = 0;
  await page.route('**/api/settings/jev**', async (route) => {
    if (route.request().url().endsWith('/models')) {
      assert.equal(settings.hasApiKey, true);
      await route.fulfill({ json: ['jev-latest', 'jev-preview', 'jev-test-remote'] });
      return;
    }
    if (route.request().url().endsWith('/probe')) {
      await route.fulfill({ json: { model: 'jev-1.13.0', latencyMs: 123 } });
      return;
    }
    if (route.request().url().endsWith('/credential')) {
      const input = route.request().postDataJSON();
      assert.equal(input.revision, settings.environmentRevision);
      keyWrites++;
      settings = {
        ...settings,
        hasApiKey: Boolean(input.apiKey),
        hasStoredApiKey: Boolean(input.apiKey),
        environmentRevision: 'e' + keyWrites,
      };
    }
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      assert.equal('apiKey' in input, false);
      writes.push(input);
      settings = { ...settings, ...input, revision: 'r' + writes.length };
    }
    await route.fulfill({ json: settings });
  });
  return writes;
}

test(
  'Jev contains only connection fields, with credentials before model and no refresh action',
  { timeout: 60000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 1000 } });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await fixture(page, true);
    await page.goto(new URL('/settings/jev', baseURL).href);
    await expect(page.locator('#jev-model [data-slot="select-value"]')).toHaveText('jev-1.13.0');
    await expect(page.locator('#jev-key')).toHaveValue('');
    await expect(page.locator('#jev-key')).toHaveAttribute('placeholder', '***************（已配置）');
    await expect(page.getByText('TypeSafe API key', { exact: true })).toHaveCount(0);
    await page.locator('#jev-model').click();
    await expect(page.getByRole('option', { name: 'jev-test-remote', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'jev-1.13.0', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('switch').count(), 0);
    assert.equal(await page.getByRole('button', { name: '刷新配置' }).count(), 0);
    assert.equal(await page.getByText('自动记忆前置判断', { exact: true }).count(), 0);
    assert.ok(
      (await page.locator('#jev-key').boundingBox()).y < (await page.locator('#jev-model').boundingBox()).y
    );
    await page.getByRole('button', { name: '测试连接' }).click();
    await expect(page.getByText('已连接 jev-1.13.0（123 毫秒）。', { exact: true })).toBeVisible();
    if (process.env.JEV_QA_DIR)
      await page.screenshot({ path: join(process.env.JEV_QA_DIR, 'jev-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth
      ),
      true
    );
    if (process.env.JEV_QA_DIR)
      await page.screenshot({ path: join(process.env.JEV_QA_DIR, 'jev-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
  }
);

test(
  'API key save and clear preserve policy drafts; model suggestions and dialog entry work',
  { timeout: 60000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 1000 } });
    t.after(() => page.close());
    const writes = await fixture(page, false);
    await page.goto(new URL('/settings/jev', baseURL).href);
    await expect(page.getByText('保存 API Key 后加载模型。', { exact: true })).toBeVisible();
    await page.locator('#jev-key').fill('browser-test-key');
    await page.getByRole('button', { name: '保存 API Key', exact: true }).click();
    await expect(page.locator('#jev-key')).toHaveValue('');
    await expect(page.locator('#jev-key')).toHaveAttribute('placeholder', '***************（已配置）');
    await page.locator('#jev-model').click();
    await page.getByRole('option', { name: 'jev-latest', exact: true }).click();
    await page.locator('#jev-key').fill('replacement-test-key');
    await page.getByRole('button', { name: '保存 API Key', exact: true }).click();
    await expect(page.locator('#jev-key')).toHaveValue('');
    await expect(page.locator('#jev-model [data-slot="select-value"]')).toHaveText('jev-latest');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    assert.equal(writes[0].model, 'jev-latest');
    await page.getByRole('button', { name: '移除密钥' }).click();
    await expect(page.locator('#jev-key')).toHaveAttribute('placeholder', '请输入 API Key');
    await expect(page.getByRole('button', { name: '测试连接' })).toBeDisabled();
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth
      ),
      true
    );
    const target = new URL('/workspaces/workspace-e2e', baseURL);
    target.searchParams.set('settings', JSON.stringify({ path: '/settings/jev' }));
    await page.goto(target.href);
    await expect(page.getByRole('dialog').locator('#jev-model [data-slot="select-value"]')).toHaveText(
      'jev-latest'
    );
  }
);

test('failed credential writes preserve the draft and allow retry', { timeout: 60000 }, async (t) => {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  t.after(() => page.close());
  await fixture(page, false);
  const credentialUrl = '**/api/settings/jev/credential';
  const rejectSave = async (route) =>
    route.fulfill({
      status: 409,
      json: {
        code: 'JEV_CONFIG_CONFLICT',
        message: 'Refresh before saving.',
      },
    });
  await page.route(credentialUrl, rejectSave);
  await page.goto(new URL('/settings/jev', baseURL).href);
  await page.locator('#jev-key').fill('retry-test-key');
  await page.getByRole('button', { name: 'Save API key', exact: true }).click();
  await expect(page.getByText('Refresh before saving.', { exact: true })).toBeVisible();
  await expect(page.locator('#jev-key')).toHaveValue('retry-test-key');
  await page.unroute(credentialUrl, rejectSave);
  await page.getByRole('button', { name: 'Save API key', exact: true }).click();
  await expect(page.locator('#jev-key')).toHaveValue('');
  await expect(page.locator('#jev-key')).toHaveAttribute('placeholder', '*************** (configured)');
});

test(
  'memory owns default-off screening and saves independently of Jev connection settings',
  { timeout: 60000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 1000 } });
    t.after(() => page.close());
    const connectionWrites = await fixture(page, true);
    let policy = { enabled: false, timeoutMs: 1500, skipThreshold: 0.95, revision: 's0' };
    const writes = [];
    await page.route('**/api/memory/service/status', (route) =>
      route.fulfill({ json: { state: 'stopped' } })
    );
    await page.route('**/api/memory/screening', async (route) => {
      if (route.request().method() === 'PUT') {
        const input = route.request().postDataJSON();
        assert.deepEqual(Object.keys(input).sort(), ['enabled', 'revision', 'skipThreshold', 'timeoutMs']);
        writes.push(input);
        policy = { ...input, revision: 's' + writes.length };
      }
      await route.fulfill({ json: policy });
    });
    await page.goto(new URL('/settings/memory', baseURL).href);
    const toggle = page.getByRole('switch', { name: '将 Jev 用于自动记忆', exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await page.locator('#memory-screening-timeout').fill('2000');
    await page.getByRole('button', { name: '保存前置判断配置' }).click();
    await expect.poll(() => writes.length).toBe(1);
    assert.equal(writes[0].enabled, true);
    assert.equal(connectionWrites.length, 0);
    await page.reload();
    await expect(toggle).toBeChecked();
    if (process.env.JEV_QA_DIR)
      await page.screenshot({ path: join(process.env.JEV_QA_DIR, 'memory-screening.png'), fullPage: true });
    await page.getByRole('link', { name: '配置 Jev 模型和 API Key' }).click();
    await expect(page.locator('#jev-model')).toBeVisible();
  }
);

test('model list failures retain the configured model and support retry', { timeout: 60000 }, async (t) => {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  t.after(() => page.close());
  await fixture(page, true);
  const fail = (route) => route.fulfill({ status: 502, json: { message: 'Model list unavailable' } });
  await page.route('**/api/settings/jev/models', fail);
  await page.goto(new URL('/settings/jev', baseURL).href);
  await expect(page.getByRole('alert')).toContainText('Model list unavailable');
  await expect(page.locator('#jev-model [data-slot="select-value"]')).toHaveText('jev-1.13.0');
  await page.unroute('**/api/settings/jev/models', fail);
  await page.getByRole('button', { name: 'Retry loading models' }).click();
  await page.locator('#jev-model').click();
  await page.getByRole('option', { name: 'jev-test-remote', exact: true }).click();
  await expect(page.locator('#jev-model [data-slot="select-value"]')).toHaveText('jev-test-remote');
});
