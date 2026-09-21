/**
 * @author Codex
 * @description Exercises Session interruption, history recovery and Fleet identity rendering in the real browser.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server;
let browser;
let baseURL;
before(async () => {
  if (process.env.E2E_BASE_URL) {
    baseURL = process.env.E2E_BASE_URL;
  } else {
    // Serve immutable production assets; dev dependency re-optimization can reload an active test page.
    const outDir = 'node_modules/.playwright-build';
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

test('invalid background state keeps a visible stop retry control', { timeout: 30000 }, async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const fixture = await installSessionFixture(page, { backgroundTasks: null });
  await page.goto(new URL(fixture.path, baseURL).href);
  const panel = page.getByRole('region', { name: '后台进程' });
  await panel.getByRole('button', { name: /后台任务/ }).click();
  const drawer = page.getByRole('dialog', { name: '后台任务', exact: true });
  await expect(drawer.getByRole('alert')).toContainText('停止尚未确认');
  await drawer.getByRole('button', { name: '重试停止' }).click();
  await expect.poll(() => fixture.getAbortCount()).toBe(1);
});

test('idle session manages background logs and stop, including reconnect', { timeout: 120000 }, async (t) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const fixture = await installSessionFixture(page, {
    backgroundTasks: {
      schemaVersion: 1,
      generation: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      accepting: true,
      activeCount: 1,
      tasks: [
        {
          taskId: '22222222-2222-4222-8222-222222222222',
          label: 'Preview server',
          state: 'running',
          createdAt: Date.now(),
        },
      ],
    },
  });
  await page.goto(new URL(fixture.path, baseURL).href);
  const panel = page.getByRole('region', { name: '后台进程' });
  await expect(panel.getByRole('button', { name: /1 个运行中/ })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Preview server', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop current run', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: /后台任务/ }).click();
  const drawer = page.getByRole('dialog', { name: '后台任务', exact: true });
  await drawer.getByRole('button', { name: '查看 Preview server 的日志', exact: true }).click();
  await expect(drawer.getByText('server ready on localhost')).toBeVisible();
  await drawer.getByRole('button', { name: '刷新日志', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '刷新日志', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: /后台任务/ })).toBeFocused();
  await page.reload();
  await panel.getByRole('button', { name: /后台任务/ }).click();
  await expect(drawer.getByText('Preview server')).toBeVisible();
  await mkdir('.playwright-artifacts', { recursive: true });
  await page.screenshot({ path: '.playwright-artifacts/background-desktop.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('button', { name: /后台任务/ }).click();
  await expect(drawer.getByRole('button', { name: '停止全部' })).toBeVisible();
  await page.screenshot({ path: '.playwright-artifacts/background-mobile.png' });
  await drawer.getByRole('button', { name: '停止全部' }).click();
  await expect(drawer.getByText('已停止', { exact: true })).toBeVisible();
  assert.equal(fixture.getAbortCount(), 1);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(panel).toHaveCount(0);
  fixture.startBackgroundTask();
  await expect(panel.getByRole('button', { name: /1 个运行中/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const persisted = localStorage.getItem('octopus-background-tasks');
        if (!persisted) return undefined;
        return JSON.parse(persisted).state.dismissedSnapshots['session-e2e'];
      })
    )
    .toBeUndefined();
  assert.deepEqual(errors, []);
});

/**
 * Opens the actual Session route and sends a prompt with the production Composer.
 */
async function openRunningSession(t, options) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'browser must not throw runtime errors');
  });
  const fixture = await installSessionFixture(page, options);
  await page.goto(new URL(fixture.path, baseURL).href);
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeEditable({ timeout: 60_000 });
  await editor.fill('Please produce a long answer.');
  await editor.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop current run', exact: true })).toBeEnabled();
  return { page, fixture };
}

for (const { partial, abortReason } of [
  { partial: '', abortReason: 'aborted' },
  { partial: 'A partial answer that must survive cancellation.', abortReason: 'aborted' },
  { partial: '', abortReason: 'error' },
  { partial: 'A partial answer that must survive cancellation.', abortReason: 'error' },
]) {
  test(
    `Stop (${abortReason}) shows Interrupted with ${partial ? 'partial' : 'empty'} output, before settlement and after reload`,
    { timeout: 120_000 },
    async (t) => {
      const { page, fixture } = await openRunningSession(t, { partial, abortReason });
      if (partial) await expect(page.getByText(partial, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Stop current run', exact: true }).click();
      await expect(page.getByText('Interrupted', { exact: true })).toBeVisible();
      await expect(page.getByText('Model request failed', { exact: true })).toHaveCount(0);
      await expect(page.getByText('This operation was aborted', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Stopping current run', exact: true })).toBeDisabled();
      assert.equal(fixture.getAbortCount(), 1);
      fixture.settle();
      await expect(page.getByRole('button', { name: 'Stopping current run', exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[contenteditable="true"]')).toBeEditable();
      await expect(page.getByText('Realtime connection lost', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Interrupted', { exact: true })).toBeVisible();
      await expect(page.getByText('Model request failed', { exact: true })).toHaveCount(0);
      if (partial) await expect(page.getByText(partial, { exact: true })).toBeVisible();
      await mkdir('.playwright-artifacts', { recursive: true });
      await page.screenshot({
        path: `.playwright-artifacts/stop-${abortReason}-${partial ? 'partial' : 'empty'}.png`,
      });
    }
  );
}

test(
  'reload during a run still allows stopping and retrying after a rejected stop',
  { timeout: 120_000 },
  async (t) => {
    const { page, fixture } = await openRunningSession(t, { holdStopReply: true });
    await page.reload();
    const stop = page.getByRole('button', { name: 'Stop current run', exact: true });
    await expect(stop).toBeEnabled();
    await stop.click();
    await expect(page.getByRole('button', { name: 'Stopping current run', exact: true })).toBeDisabled();
    fixture.failStop();
    await expect(page.getByText('Background stop timed out', { exact: true })).toBeVisible();
    await expect(stop).toBeEnabled();
    await stop.click();
    assert.equal(fixture.getAbortCount(), 2);
    fixture.settle();
    fixture.failStop();
    await expect(page.getByRole('button', { name: 'Stopping current run', exact: true })).toHaveCount(0);
  }
);

test(
  'stop confirmation timeout unlocks the control without claiming the run is idle',
  { timeout: 120_000 },
  async (t) => {
    const { page } = await openRunningSession(t, { holdStopReply: true });
    await page.clock.install();
    await page.getByRole('button', { name: 'Stop current run', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stopping current run', exact: true })).toBeDisabled();
    await page.clock.fastForward(20_001);
    await expect(
      page.getByText('Command confirmation timed out. Check the session state and retry.', { exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop current run', exact: true })).toBeEnabled();
  }
);

test('an error remains visible even when its text mentions aborted', { timeout: 120_000 }, async (t) => {
  const { page, fixture } = await openRunningSession(t);
  fixture.finish('error', 'Upstream request aborted unexpectedly');
  fixture.settle();
  await expect(page.getByText('Model request failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Upstream request aborted unexpectedly', { exact: true })).toBeVisible();
  await expect(page.getByText('Interrupted', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[contenteditable="true"]')).toBeEditable();
  await expect(page.getByText('Realtime connection lost', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Model request failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Interrupted', { exact: true })).toHaveCount(0);
});

test(
  'background stop failure remains visible after the main Agent settles',
  { timeout: 120_000 },
  async (t) => {
    const { page, fixture } = await openRunningSession(t, { holdStopReply: true });
    await page.getByRole('button', { name: 'Stop current run', exact: true }).click();
    await expect(page.getByText('Interrupted', { exact: true })).toBeVisible();
    fixture.settle();
    await expect(page.getByRole('button', { name: 'Stopping current run', exact: true })).toHaveCount(0);
    fixture.failStop();
    await expect(page.getByText('Background stop timed out', { exact: true })).toBeVisible();
  }
);

test('workflow steps and standalone agents retain avatars across collapse and reload', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    const subagentFleet = {
      kind: 'pi-subagents.async-status-snapshot',
      version: 1,
      generatedAt: 1000,
      omitted: { runs: 0, children: 0, byteLimitExceeded: false },
      runs: [
        {
          id: 'workflow',
          kind: 'workflow',
          label: 'delegate, +2 more',
          state: 'running',
          children: ['step', 'host-step', 'subagent'].map((kind, index) => ({
            id: kind,
            kind,
            label: 'delegate',
            state: ['running', 'complete', 'failed'][index],
          })),
        },
      ],
    };
    const fixture = await installSessionFixture(page, { subagentFleet });
    await page.goto(new URL(fixture.path, baseURL).href);
    const toggle = page.getByRole('button', { name: /Subagents background/ });
    const avatars = page.locator('svg[shape-rendering="crispEdges"]');
    await expect(avatars).toHaveCount(3, { timeout: 60_000 });
    const artwork = await avatars.evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
    assert.equal(new Set(artwork).size, 3);
    const colors = [];
    for (const state of ['running', 'complete', 'failed']) {
      colors.push(
        await page
          .getByText(state, { exact: true })
          .last()
          .evaluate((node) => node.ownerDocument.defaultView.getComputedStyle(node).color)
      );
    }
    assert.equal(new Set(colors).size, 3, 'active, complete and failed badges need distinct rendered colors');
    await toggle.click();
    await expect(avatars.first()).not.toBeVisible();
    await toggle.click();
    await expect(avatars.first()).toBeVisible();
    await page.reload();
    await expect(avatars).toHaveCount(3, { timeout: 60_000 });
    assert.deepEqual(await avatars.evaluateAll((nodes) => nodes.map((node) => node.outerHTML)), artwork);
  } finally {
    await page.close();
  }
});
