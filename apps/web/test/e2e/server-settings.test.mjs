/**
 * @author Codex
 * @description Exercises Server settings, exposure confirmation and restart outcomes in the real browser.
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
const artifacts = join(tmpdir(), 'octopus-server-settings-browser');
before(async () => {
  await mkdir(artifacts, { recursive: true });
  if (process.env.E2E_BASE_URL) baseURL = process.env.E2E_BASE_URL;
  else {
    const outDir = 'node_modules/.playwright-server-settings';
    await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
    server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } });
    baseURL = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
});

/**
 * Isolates browser writes from user configuration and records the actual HTTP mutation sequence.
 */
async function fixture(page) {
  await installSessionFixture(page);
  const values = {
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: 3000,
    SERVER_CORS_ORIGIN: '',
    SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: 5,
    SERVER_MAX_ACTIVE_RUNTIMES: 9,
    SERVER_FILE_LOG_ENABLED: false,
    SERVER_FILE_LOG_LEVEL: 'info',
    SERVER_FILE_LOG_MAX_SIZE_MB: 50,
    SERVER_FILE_LOG_RETENTION_DAYS: 14,
    SERVER_FILE_LOG_MAX_FILES: 30,
    SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: 1024,
    SERVER_FILE_LOG_REQUIRED: false,
  };
  const snapshot = {
    revision: 'a'.repeat(64),
    serviceInstanceId: '11111111-1111-4111-8111-111111111111',
    fields: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        {
          stored: { configured: false, value: null },
          current: { configured: true, value },
          next: { configured: true, value },
          source: 'default',
          overridden: false,
        },
      ])
    ),
    pendingRestartFields: [],
    additionalPendingRestart: false,
    prediction: 'known',
    diagnostics: [],
    runtime: {
      state: 'running',
      address: 'http://127.0.0.1:3000',
      activeRuntimeCount: 2,
      fileLogging: {
        enabled: false,
        state: 'disabled',
        directory: 'C:\\Users\\test\\.dr-octopus\\server\\logs',
      },
    },
    capabilities: { edit: true, restart: true, reason: null },
  };
  const writes = [];
  let restarts = 0;
  let operation;
  await page.route('**/api/settings/server**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.includes('restart-operations')) {
      operation.state = 'succeeded';
      operation.completedAt = new Date().toISOString();
      snapshot.serviceInstanceId = '22222222-2222-4222-8222-222222222222';
      snapshot.pendingRestartFields = [];
      for (const field of Object.values(snapshot.fields)) field.current = { ...field.next };
      return route.fulfill({ json: { operation } });
    }
    if (request.method() === 'POST') {
      restarts++;
      assert.ok(request.headers()['idempotency-key']);
      operation = {
        operationId: '33333333-3333-4333-8333-333333333333',
        state: 'accepted',
        sourceInstanceId: snapshot.serviceInstanceId,
        targetInstanceId: null,
        targetRevision: snapshot.revision,
        actualAddress: null,
        acceptedAt: new Date().toISOString(),
        completedAt: null,
        access: { kind: 'same_origin', port: 3000, loopbackUrl: 'http://127.0.0.1:3000' },
        error: null,
      };
      return route.fulfill({ status: 202, json: { operation, outcome: 'accepted', warnings: [] } });
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push(body);
      if (
        body.changes.SERVER_HOST === '0.0.0.0' &&
        request.headers()['x-octopus-confirm-exposure'] !== 'true'
      ) {
        return route.fulfill({
          status: 409,
          json: {
            code: 'SERVER_EXPOSURE_CONFIRMATION_REQUIRED',
            message: 'Confirm exposure',
            retryable: false,
          },
        });
      }
      snapshot.revision = 'b'.repeat(64);
      for (const [key, value] of Object.entries(body.changes)) {
        snapshot.fields[key].stored = { configured: value !== null, value };
        snapshot.fields[key].next.value =
          value === null
            ? values[key]
            : typeof values[key] === 'number'
              ? Number(value)
              : typeof values[key] === 'boolean'
                ? value === 'true'
                : value;
        snapshot.fields[key].source = value === null ? 'default' : 'file';
      }
      snapshot.pendingRestartFields = Object.keys(body.changes);
      return route.fulfill({
        json: {
          settings: snapshot,
          outcome: 'applied',
          warnings: [],
          effect: { kind: 'server_restart', currentServer: 'unchanged', requiredAction: 'restart_service' },
        },
      });
    }
    return route.fulfill({ json: snapshot });
  });
  return { writes, snapshot, restarts: () => restarts };
}

test(
  'Expose server saves only after confirmation and restart remains an explicit action',
  { timeout: 60_000 },
  async (t) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await fixture(page);
    await page.goto(new URL('/settings/server', baseURL).href);
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
    await page.screenshot({ path: join(artifacts, 'desktop-light.png') });
    await page.getByRole('switch', { name: '允许其他设备访问', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '重启服务', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '保存设置', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '允许其他设备访问？' })).toBeVisible();
    assert.equal(state.restarts(), 0);
    await page.getByRole('button', { name: '确认并保存' }).click();
    await expect(page.getByText('待重启', { exact: true })).toBeVisible();
    assert.equal(state.restarts(), 0);
    assert.deepEqual(state.writes.at(-1).changes, { SERVER_HOST: '0.0.0.0' });
    await page.getByRole('button', { name: '重启服务', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '重启服务？' })).toContainText('2 个驻留会话实例');
    await page.getByRole('button', { name: '确认重启' }).click();
    await expect(page.getByText('服务已重启', { exact: true })).toBeVisible();
    assert.equal(state.restarts(), 1);
    assert.deepEqual(errors, []);
  }
);

test(
  'restoring inheritance hides the old override until saving and supports undo',
  { timeout: 60_000 },
  async (t) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await fixture(page);
    const port = state.snapshot.fields.SERVER_PORT;
    port.stored = { configured: true, value: '3100' };
    port.next.value = 3100;
    port.source = 'file';
    await page.goto(new URL('/settings/server', baseURL).href);
    const field = page
      .locator('[data-slot="field"]')
      .filter({ has: page.locator('label[for="SERVER_PORT"]') });
    await expect(field.getByRole('spinbutton')).toHaveValue('3100');
    await field.locator('summary').click();
    await field.getByRole('button', { name: '恢复继承', exact: true }).click();
    await expect(field.getByRole('spinbutton')).toHaveCount(0);
    await expect(field.getByText('保存后恢复继承；继承值将在保存后显示。')).toBeVisible();
    await field.getByRole('button', { name: '撤销恢复继承', exact: true }).click();
    await expect(field.getByRole('spinbutton')).toHaveValue('3100');
    await field.getByRole('button', { name: '恢复继承', exact: true }).click();
    await page.screenshot({ path: join(artifacts, 'restore-inheritance.png') });
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(field.getByRole('spinbutton')).toHaveValue('3000');
    assert.deepEqual(state.writes.at(-1).changes, { SERVER_PORT: null });
    assert.deepEqual(errors, []);
  }
);

test('narrow dark layout and numeric validation preserve the draft', { timeout: 60_000 }, async (t) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  t.after(() => page.close());
  await fixture(page);
  await page.goto(new URL('/settings/server', baseURL).href);
  await expect(page.getByLabel('服务端口', { exact: true })).toBeVisible();
  await page.getByLabel('服务端口', { exact: true }).fill('70000');
  await expect(page.getByText('请输入 1–65535 的整数。')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
  await page.getByLabel('服务端口', { exact: true }).fill('3100');
  await page.screenshot({ path: join(artifacts, 'mobile-dark.png') });
  assert.equal(
    await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth),
    false
  );
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth),
    false
  );
});

test(
  'Settings dialog shares the service card layout and guards unsaved navigation',
  { timeout: 60_000 },
  async (t) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    t.after(() => page.close());
    await fixture(page);
    await page.route('**/api/memory/**', (route) =>
      route.fulfill({ json: { state: 'running', mode: 'manual', revision: 'a' } })
    );
    await page.route('**/api/settings/environment/server', (route) =>
      route.fulfill({
        json: { scope: 'server', path: 'C:/test/environment.json', revision: 'a'.repeat(64), entries: [] },
      })
    );
    await page.goto(new URL('/settings/memory', baseURL).href);
    await expect(page.getByRole('button', { name: '重启记忆服务', exact: true })).toBeVisible();
    await page.screenshot({ path: join(artifacts, 'reference-memory.png') });
    await page.goto(new URL('/settings/environment', baseURL).href);
    await page.screenshot({ path: join(artifacts, 'reference-environment.png') });
    await page.goto(new URL('/', baseURL).href);
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('button', { name: '服务', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '重启服务', exact: true })).toBeVisible();
    await page.screenshot({ path: join(artifacts, 'modal-light.png') });
    await dialog.getByLabel('服务端口', { exact: true }).fill('3100');
    page.once('dialog', (event) => event.dismiss());
    await page.goBack();
    await expect(dialog.getByLabel('服务端口', { exact: true })).toHaveValue('3100');
    page.once('dialog', (event) => event.accept());
    await page.goBack();
    await expect(dialog).toHaveCount(0);
  }
);
