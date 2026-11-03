/**
 * @author Codex
 * @description Validates real Chrome/Edge capture, private storage, toolbar controls and popup recovery in isolated profiles.
 */
import { verifyPopupContentBounds } from './popup-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { verifyRecordingBoundaries } from './recording-boundaries.mjs';
/* global chrome */
const root = fileURLToPath(new URL('../../', import.meta.url));
const repositoryBundle = await build({
  entryPoints: [join(root, 'src/lib/recording/recording-repository.ts')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'RecorderRepositoryTest',
});

for (const flavor of ['chrome', 'edge']) {
  test(
    `isolated ${flavor}: capture, pause, related tab, popup closure and durable redacted evidence`,
    { timeout: 120000 },
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), 'octopus-recorder-'));
      const evidence = join(temporary, 'evidence');
      await mkdir(evidence);
      const server = createServer((_request, response) => {
        if (_request.url === '/boundary-redirect-out') {
          response.writeHead(302, { Location: `http://localhost:${server.address().port}/outside` });
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          '<!doctype html><html lang="zh-CN"><head><title>订单管理</title></head><body style="font:16px system-ui;padding:60px"><h1>订单管理</h1><label>订单号<input id="order"></label><label>密码<input type="password" id="password"></label><button id="search">查询</button><a href="/details" target="_blank" rel="opener">打开详情</a><p style="height:1000px">测试订单页面</p></body></html>'
        );
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      let context;
      let succeeded = false;
      try {
        const extension = join(temporary, 'extension');
        await cp(join(root, '.output', flavor + '-mv3'), extension, { recursive: true });
        const backgroundPath = join(extension, 'background.js');
        const background = await readFile(backgroundPath, 'utf8');
        assert.equal(background.split('com.octopus.executor.browser').length, 2);
        await writeFile(
          backgroundPath,
          background.replace('com.octopus.executor.browser', 'com.octopus.test.recorder_unregistered')
        );
        const manifestPath = join(extension, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const { identity } = JSON.parse(await readFile(join(extension, 'browser-identity.json'), 'utf8'));
        await writeFile(manifestPath, JSON.stringify({ ...manifest, key: identity.sideloadPublicKey }));
        const executablePath =
          flavor === 'chrome'
            ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
            : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
        context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
          executablePath,
          headless: false,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000', '--no-first-run'],
        });
        const cdp = await context.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
        assert.equal(id, identity.sideloadExtensionId);
        const worker =
          context.serviceWorkers().find((item) => item.url().includes(id)) ??
          (await context.waitForEvent('serviceworker'));
        const business = await context.newPage();
        await business.setViewportSize({ width: 1280, height: 800 });
        await business.goto(`http://127.0.0.1:${server.address().port}/orders`);
        const popup = await context.newPage();
        await popup.setViewportSize({ width: 360, height: 600 });
        await business.bringToFront();
        await popup.goto(`chrome-extension://${id}/popup.html`);
        await expect(popup.getByRole('tab').first()).toHaveText('连接状态');
        await expect(popup.getByRole('tab', { name: '连接状态', exact: true })).toHaveAttribute(
          'aria-selected',
          'true'
        );
        await business.bringToFront();
        await popup.getByRole('tab', { name: '录制重放', exact: true }).evaluate((element) => element.click());
        await expect(popup.getByRole('button', { name: '开始录制', exact: true })).toBeEnabled();
        await expect(popup.getByText('暂无录制记录', { exact: true })).toBeVisible();
        await expect(popup.locator('[data-slot="empty"]')).toBeVisible();
        await expect(popup.getByRole('checkbox')).toHaveAccessibleName('同时录制从当前页面打开的新标签页');
        await popup.getByRole('checkbox').check();
        await popup.screenshot({ path: join(evidence, 'recording-start.png'), fullPage: true });
        await popup.getByRole('button', { name: '开始录制', exact: true }).click();
        const toolbar = business.getByRole('region', { name: 'Dr.Octopus 录制工具栏' });
        await expect(toolbar).toBeVisible();
        const toolbarStyle = await toolbar.evaluate((element) => {
          const style = getComputedStyle(element);
          const button = getComputedStyle(element.querySelector('button'));
          return {
            border: style.border,
            radius: style.borderRadius,
            shadow: style.boxShadow,
            radiusVar: style.getPropertyValue('--radius'),
            background: style.backgroundColor,
            buttonRadius: button.borderRadius,
          };
        });
        assert.notEqual(toolbarStyle.border, '0px none oklch(0.922 0 0)');
        assert.notEqual(toolbarStyle.shadow, 'none');
        assert.notEqual(toolbarStyle.buttonRadius, '0px');
        await popup.close();
        await business.locator('#order').fill('PRIVATE-ORDER-12345');
        await business.locator('#password').fill('PRIVATE-PASSWORD-998877');
        await business.locator('#search').click();
        await expect(toolbar).toContainText('步');
        await toolbar.getByRole('button', { name: '暂停录制', exact: true }).click();
        await expect(toolbar).toContainText('已暂停');
        await verifyToolbarPlacement(business, toolbar, evidence);
        await business.screenshot({ path: join(evidence, 'recording-paused.png') });
        const before = await worker.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('octopus-recordings');
            r.onsuccess = () => resolve(r.result);
            r.onerror = reject;
          });
          return new Promise((resolve) => {
            const r = db.transaction('sessions').objectStore('sessions').getAll();
            r.onsuccess = () => {
              db.close();
              resolve(r.result[0].count);
            };
          });
        });
        await business.locator('#search').click();
        await toolbar.getByRole('button', { name: '继续录制', exact: true }).click();
        await expect(toolbar).toContainText('录制中');
        await toolbar.getByRole('button', { name: '收起工具栏', exact: true }).click();
        await expect(toolbar.getByRole('button', { name: '展开工具栏', exact: true })).toBeVisible();
        await business.screenshot({ path: join(evidence, 'recording-collapsed.png') });
        const nextPage = context.waitForEvent('page');
        await business.getByRole('link', { name: '打开详情' }).click();
        const related = await nextPage;
        await related.waitForLoadState();
        const relatedToolbar = related.getByRole('region', { name: 'Dr.Octopus 录制工具栏' });
        await expect(relatedToolbar).toBeVisible();
        await expect(relatedToolbar).toContainText('2 个页面');
        await relatedToolbar.getByRole('button', { name: '停止并保存', exact: true }).click();
        await expect(relatedToolbar).toHaveCount(0);
        await expect(toolbar).toHaveCount(0);
        const reopened = await context.newPage();
        await reopened.setViewportSize({ width: 360, height: 600 });
        await reopened.goto(`chrome-extension://${id}/popup.html`);
        await expect(reopened.getByRole('tab', { name: '连接状态', exact: true })).toHaveAttribute(
          'aria-selected',
          'true'
        );
        await reopened.getByRole('tab', { name: '录制重放', exact: true }).click();
        await expect(reopened.getByText('待整理', { exact: true })).toBeVisible();
        await reopened.getByRole('button', { name: /订单管理录制/ }).click();
        await expect(reopened.getByRole('heading', { name: '录制详情', exact: true })).toBeVisible();
        await expect(reopened.getByRole('button', { name: '返回录制记录', exact: true })).toBeVisible();
        await expect(
          reopened.getByText('操作记录保存在此浏览器。工作流整理与重放尚未开放。', { exact: true })
        ).toHaveCount(0);
        await reopened.getByLabel('名称', { exact: true }).fill('重命名录制');
        await expect(reopened.getByRole('button', { name: '保存', exact: true })).toHaveClass(/bg-primary/);
        await reopened.getByRole('button', { name: '保存', exact: true }).click();
        await expect(reopened.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
        await expect(reopened.getByRole('button', { name: '删除录制', exact: true })).toHaveClass(
          /text-destructive/
        );
        await expect(reopened.getByText('操作步骤', { exact: true })).toBeVisible();
        await reopened.screenshot({ path: join(evidence, 'recording-detail.png'), fullPage: true });
        const persisted = await worker.evaluate(async () => {
          const db = await new Promise((resolve) => {
            const r = indexedDB.open('octopus-recordings');
            r.onsuccess = () => resolve(r.result);
          });
          const tx = db.transaction(['sessions', 'events']);
          const values = await Promise.all(
            ['sessions', 'events'].map(
              (name) =>
                new Promise((resolve) => {
                  const r = tx.objectStore(name).getAll();
                  r.onsuccess = () => resolve(r.result);
                })
            )
          );
          db.close();
          return { sessions: values[0], events: values[1] };
        });
        assert.equal(persisted.sessions[0].status, 'stopped');
        assert.ok(persisted.sessions[0].count > before);
        assert.ok(persisted.events.some((item) => item.action === 'input' && item.redacted));
        assert.ok(persisted.events.some((item) => item.action === 'tab_open'));
        assert.ok(!JSON.stringify(persisted).includes('PRIVATE-ORDER'));
        assert.ok(!JSON.stringify(persisted).includes('PRIVATE-PASSWORD'));
        assert.ok(!persisted.events.some((item) => /停止保存|暂停录制|继续录制/.test(item.label)));
        const pagination = await verifyPagination(worker, reopened, evidence, persisted.sessions[0]);
        const storage = await verifyStorageEvolution(business, persisted.sessions[0], persisted.events[0]);
        const quota = await verifyQuotaFailure(context, business, persisted.sessions[0]);
        const workerRecovery = await verifyWorkerRecovery(context, business, reopened);
        const lifecycle = await verifyDocumentLifecycle(context, business, reopened);
        const boundaries = await verifyRecordingBoundaries(
          context,
          reopened,
          `http://127.0.0.1:${server.address().port}`
        );
        const restartPage = await context.newPage();
        await restartPage.goto(`http://127.0.0.1:${server.address().port}/restart`);
        const restartTab = await reopened.evaluate(
          async () => (await chrome.tabs.query({})).find((tab) => tab.url?.endsWith('/restart')).id
        );
        const restartSession = await reopened.evaluate(
          async (tabId) =>
            chrome.runtime.sendMessage({ type: 'recorder.start', tabId, includeRelated: false }),
          restartTab
        );
        assert.equal(restartSession.ok, true);
        await expect(restartPage.getByRole('region', { name: 'Dr.Octopus 录制工具栏' })).toBeVisible();
        await restartPage.locator('#search').click();
        await expect
          .poll(
            async () =>
              (
                await reopened.evaluate(
                  async (id) =>
                    chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
                  restartSession.value.id
                )
              ).value.session.count
          )
          .toBeGreaterThan(0);
        await context.close();
        context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
          executablePath,
          headless: false,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000', '--no-first-run'],
        });
        const restartCdp = await context.browser().newBrowserCDPSession();
        await restartCdp.send('Extensions.loadUnpacked', { path: extension });
        const afterRestart = await context.newPage();
        await afterRestart.goto(`chrome-extension://${id}/popup.html`);
        const restored = await afterRestart.evaluate(
          async (sessionId) => ({
            status: await chrome.runtime.sendMessage({ type: 'recorder.status' }),
            detail: await chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId, after: 0 }),
          }),
          restartSession.value.id
        );
        assert.equal(restored.status.ok, true);
        assert.equal(restored.status.value.active, null);
        assert.equal(restored.detail.value.session.status, 'interrupted');
        assert.ok(restored.detail.value.events.length > 0);
        lifecycle.browserRestart = true;
        lifecycle.restartKind = 'graceful close and reopen of isolated profile; not a crash';
        await writeFile(
          join(evidence, 'result.json'),
          JSON.stringify(
            {
              flavor,
              before,
              count: persisted.events.length,
              pagination,
              storage,
              quota,
              workerRecovery,
              lifecycle,
              boundaries,
              gaps: persisted.sessions[0].gaps,
              checks: [
                'popup closure',
                'pause/resume',
                'related tab',
                'redaction',
                'toolbar exclusion',
                'durable stop',
              ],
            },
            null,
            2
          )
        );
        console.log(`Recorder evidence: ${evidence}`);
        succeeded = true;
      } finally {
        await context?.close();
        await new Promise((resolve) => server.close(resolve));
        // Preserve screenshots and failure evidence; only the disposable profile and copied extension are removed.
        for (const name of ['profile', 'extension']) {
          const target = resolve(temporary, name);
          assert.ok(target.startsWith(resolve(temporary) + '\\'));
          await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
        if (!succeeded) {
          console.log(`Recorder failure evidence directory: ${evidence}`);
        }
      }
    }
  );
}

/**
 * Keeps the expanded toolbar stable at both edges and inside the viewport after expansion and resize.
 */
async function verifyToolbarPlacement(page, toolbar, evidence) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 600, height: 600 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const initial = await toolbar.boundingBox();
  /**
   * Exercises the real pointer-capture drag path past the requested viewport edge.
   */
  async function dragTo(x) {
    const handle = await toolbar.getByRole('button', { name: '拖动录制工具栏' }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  /**
   * Checks the layout result rather than particular CSS declarations.
   */
  async function assertExpanded() {
    await expect
      .poll(async () => {
        const bounds = await toolbar.boundingBox();
        const pause = await toolbar.getByRole('button', { name: '继续录制', exact: true }).boundingBox();
        const collapse = await toolbar.getByRole('button', { name: '收起工具栏', exact: true }).boundingBox();
        return (
          bounds.x >= 0 &&
          bounds.x + bounds.width <= page.viewportSize().width + 1 &&
          Math.abs(bounds.width - initial.width) < 1 &&
          Math.abs(pause.y - collapse.y) < 1
        );
      })
      .toBe(true);
  }
  await dragTo(599);
  await page.screenshot({ path: join(evidence, 'toolbar-right-edge.png') });
  await assertExpanded();
  await dragTo(0);
  await assertExpanded();
  await toolbar.getByRole('button', { name: '收起工具栏', exact: true }).click();
  await dragTo(599);
  await toolbar.getByRole('button', { name: '展开工具栏', exact: true }).click();
  await assertExpanded();
  await page.setViewportSize({ width: 520, height: 600 });
  await assertExpanded();
  await page.screenshot({ path: join(evidence, 'toolbar-expanded-at-edge.png') });
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: 'light' });
}

/**
 * Forces a real IndexedDB quota rejection for the isolated fixture origin and checks atomic recovery.
 */
async function verifyQuotaFailure(context, page, template) {
  const cdp = await context.newCDPSession(page);
  const origin = new URL(page.url()).origin;
  try {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1 });
    const budget = await cdp.send('Storage.getUsageAndQuota', { origin });
    assert.equal(budget.quota, 1);
    const outcome = await page.evaluate(async (template) => {
      const repository = new window.RecorderRepositoryTest.RecordingRepository();
      let failure;
      try {
        await repository.save({
          ...template,
          name: Array.from({ length: 128 }, () => {
            const bytes = crypto.getRandomValues(new Uint8Array(65536));
            return btoa(String.fromCharCode(...bytes));
          }).join(''),
          count: template.count + 1,
        });
      } catch (error) {
        failure = { message: error.message, cause: error.cause?.name };
      }
      const preserved = await repository.get(template.id);
      return { failure, preservedName: preserved.name === template.name, count: preserved.count };
    }, template);
    if (!outcome.failure) {
      await cdp.send('Storage.overrideQuotaForOrigin', { origin });
      await page.evaluate(async (template) => {
        await new window.RecorderRepositoryTest.RecordingRepository().save(template);
      }, template);
      return {
        status: 'blocked',
        reportedQuota: budget.quota,
        reason:
          'native IndexedDB accepted a bounded 11 MiB write despite quota override; no QuotaExceededError induced',
        physicalDiskExhaustionAttempted: false,
      };
    }
    assert.equal(outcome.failure?.message, 'RECORDING_STORAGE');
    assert.equal(outcome.failure?.cause, 'QuotaExceededError');
    assert.equal(outcome.preservedName, true);
    assert.equal(outcome.count, template.count);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin });
    const recovery = await page.evaluate(async (template) => {
      const repository = new window.RecorderRepositoryTest.RecordingRepository();
      await repository.save({ ...template, name: '配额恢复后保存' });
      return (await repository.get(template.id)).name;
    }, template);
    assert.equal(recovery, '配额恢复后保存');
    return {
      ...outcome,
      recovered: true,
      scope: 'native IndexedDB in HTTP fixture origin; quota override, not physical disk exhaustion',
    };
  } finally {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin });
    await cdp.detach();
  }
}

/**
 * Stops the isolated profile's worker and verifies durable ownership and subsequent page input after restart.
 */
async function verifyWorkerRecovery(context, page, manager) {
  const tabId = await manager.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    page.url()
  );
  const started = await manager.evaluate(
    async (tabId) => chrome.runtime.sendMessage({ type: 'recorder.start', tabId, includeRelated: false }),
    tabId
  );
  assert.equal(started.ok, true);
  await expect(page.getByRole('region', { name: 'Dr.Octopus 录制工具栏' })).toBeVisible();
  await page.locator('#search').click();
  const read = () =>
    manager.evaluate(
      async (id) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
      started.value.id
    );
  await expect.poll(async () => (await read()).value.session.count).toBeGreaterThan(0);
  const count = (await read()).value.session.count;
  const cdp = await context.newCDPSession(manager);
  const browserCdp = await context.browser().newBrowserCDPSession();
  try {
    const old = (await browserCdp.send('Target.getTargets')).targetInfos.find(
      (target) => target.type === 'service_worker' && target.url.includes('/background.js')
    );
    assert.ok(old);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await expect
      .poll(async () =>
        (await browserCdp.send('Target.getTargets')).targetInfos.some(
          (target) => target.targetId === old.targetId
        )
      )
      .toBe(false);
    const state = await manager.evaluate(async () => chrome.runtime.sendMessage({ type: 'recorder.status' }));
    assert.equal(state.value.active.id, started.value.id);
    assert.equal(state.value.active.status, 'recording');
    await page.locator('#search').click();
    await expect.poll(async () => (await read()).value.session.count).toBeGreaterThan(count);
    const currentWorker = context.serviceWorkers().find((item) => item.url().includes('/background.js'));
    assert.ok(currentWorker);
    await currentWorker.evaluate(() => {
      globalThis.__capturePendingFact = null;
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value, ...args) {
        if (this.name === 'events' && value.label === '在途恢复测试') {
          globalThis.__capturePendingFact = value.id;
        }
        return add.call(this, value, ...args);
      };
    });
    await manager.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('octopus-recordings');
        r.onsuccess = () => resolve(r.result);
        r.onerror = reject;
      });
      const tx = db.transaction('sessions', 'readonly');
      const deadline = Date.now() + 5000;
      window.__captureGateReleased = false;
      window.__captureGateExpired = false;
      window.__captureGateDone = new Promise((resolve) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          resolve();
        };
      });
      const hold = () => {
        if (!window.__captureGateReleased && Date.now() < deadline) {
          const r = tx.objectStore('sessions').get('gate');
          r.onsuccess = hold;
        } else if (!window.__captureGateReleased) {
          window.__captureGateExpired = true;
        }
      };
      hold();
    });
    let pendingFact;
    try {
      await page.locator('#search').evaluate((element) => {
        element.textContent = '在途恢复测试';
      });
      await page.locator('#search').click();
      await expect
        .poll(async () => currentWorker.evaluate(() => globalThis.__capturePendingFact))
        .not.toBeNull();
      pendingFact = await currentWorker.evaluate(() => globalThis.__capturePendingFact);
      const blockedTarget = (await browserCdp.send('Target.getTargets')).targetInfos.find(
        (target) => target.type === 'service_worker' && target.url.includes('/background.js')
      );
      await cdp.send('ServiceWorker.disable');
      const versions = new Map();
      /**
       * Tracks the actual current worker version while its old context is stopped.
       */
      const versionChanged = ({ versions: changed }) => {
        for (const item of changed) {
          versions.set(item.versionId, item);
        }
      };
      cdp.on('ServiceWorker.workerVersionUpdated', versionChanged);
      try {
        await cdp.send('ServiceWorker.enable');
        await expect
          .poll(() => [...versions.values()].some((item) => item.targetId === blockedTarget.targetId))
          .toBe(true);
        const version = [...versions.values()].find((item) => item.targetId === blockedTarget.targetId);
        await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
        await assert.rejects(
          currentWorker.evaluate(() => globalThis.__capturePendingFact),
          /Service worker restarted|closed|destroyed/i
        );
        assert.equal(
          await manager.evaluate(() => window.__captureGateExpired),
          false,
          'the write gate must still be held when the old worker context exits'
        );
      } finally {
        cdp.off('ServiceWorker.workerVersionUpdated', versionChanged);
      }
    } finally {
      await manager.evaluate(async () => {
        window.__captureGateReleased = true;
        await window.__captureGateDone;
      });
    }
    await expect
      .poll(async () => (await read()).value.events.filter((event) => event.id === pendingFact).length)
      .toBe(1);
    await page.locator('#search').evaluate((element) => {
      element.textContent = '查询';
    });
    const stopped = await manager.evaluate(
      async (id) => chrome.runtime.sendMessage({ type: 'recorder.control', sessionId: id, action: 'stop' }),
      started.value.id
    );
    assert.equal(stopped.ok, true);
    await expect(page.getByRole('region', { name: 'Dr.Octopus 录制工具栏' })).toHaveCount(0);
    return {
      oldTargetRemoved: true,
      sessionPreserved: true,
      laterInputCommitted: true,
      pendingTransactionInterrupted: true,
      pendingWorkerContextClosed: true,
      pendingFactCommittedOnce: true,
    };
  } finally {
    await cdp.detach();
    await browserCdp.detach();
  }
}

/**
 * Verifies real document replacement, unsupported frames, open shadow roots and last-tab termination.
 */
async function verifyDocumentLifecycle(context, page, manager) {
  await page.goto(page.url());
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'shadow-fixture';
    host.attachShadow({ mode: 'open' }).innerHTML = '<button>影子查询</button><label>影子输入<input></label>';
    document.body.prepend(host);
  });
  const tabId = await manager.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    page.url()
  );
  const started = await manager.evaluate(
    async (tabId) => chrome.runtime.sendMessage({ type: 'recorder.start', tabId, includeRelated: false }),
    tabId
  );
  assert.equal(started.ok, true);
  const id = started.value.id;
  await expect(page.getByRole('region', { name: 'Dr.Octopus 录制工具栏' })).toBeVisible();
  const initialState = await manager.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
    id
  );
  assert.ok(!initialState.value.session.gaps.some((gap) => gap.includes('iframe')));
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'frame-fixture';
    frame.srcdoc = '<button>框架内部操作</button><iframe srcdoc="<button>嵌套操作</button>"></iframe>';
    document.body.prepend(frame);
  });

  await page.locator('#order').focus();
  const inputSession = await context.newCDPSession(page);
  try {
    await inputSession.send('Input.imeSetComposition', { text: '订', selectionStart: 1, selectionEnd: 1 });
    await inputSession.send('Input.imeSetComposition', { text: '订单', selectionStart: 2, selectionEnd: 2 });
    await inputSession.send('Input.insertText', { text: '订单私密值' });
  } finally {
    await inputSession.detach();
  }
  await page.locator('#search').click();
  await expect
    .poll(
      async () =>
        (
          await manager.evaluate(
            async (id) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
            id
          )
        ).value.events.filter((event) => event.action === 'input' && event.label === '订单号').length
    )
    .toBe(1);
  await page.locator('#shadow-fixture').getByRole('button').click();
  await page.locator('#shadow-fixture').getByRole('textbox').fill('私密影子值');
  await page.locator('#search').click();
  await page
    .frameLocator('#frame-fixture')
    .getByRole('button', { name: '框架内部操作', exact: true })
    .click();
  await page
    .frameLocator('#frame-fixture')
    .frameLocator('iframe')
    .getByRole('button', { name: '嵌套操作', exact: true })
    .click();
  await expect
    .poll(async () => {
      const reply = await manager.evaluate(
        async (id) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
        id
      );
      return reply.value.events.some((event) => event.label === '影子查询');
    })
    .toBe(true);
  const before = await manager.evaluate(
    async (id) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
    id
  );
  assert.ok(before.value.session.gaps.some((gap) => gap.includes('iframe')));
  assert.ok(!before.value.events.some((event) => ['框架内部操作', '嵌套操作'].includes(event.label)));
  assert.ok(!JSON.stringify(before).includes('私密影子值'));
  assert.ok(!JSON.stringify(before).includes('订单私密值'));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Dr.Octopus 录制工具栏' })).toBeVisible();
  await page.locator('#search').click();
  await expect
    .poll(
      async () =>
        (
          await manager.evaluate(
            async (id) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
            id
          )
        ).value.session.count
    )
    .toBeGreaterThan(before.value.session.count);
  await page.close();
  await expect
    .poll(
      async () =>
        (
          await manager.evaluate(
            async (id) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId: id, after: 0 }),
            id
          )
        ).value.session.status
    )
    .toBe('interrupted');
  const replacement = await context.newPage();
  await replacement.goto('about:blank');
  assert.equal(await replacement.locator('[data-octopus-recorder]').count(), 0);
  return {
    shadow: true,
    iframeExcluded: true,
    dynamicNestedFrameGap: true,
    reload: true,
    lastTabInterrupted: true,
    imeComposition: 'browser Input.imeSetComposition, not physical OS IME',
  };
}

/**
 * Exercises the actual repository over native IndexedDB in the isolated fixture origin, including non-destructive upgrade.
 */
async function verifyStorageEvolution(page, template, event) {
  await page.addScriptTag({ content: repositoryBundle.outputFiles[0].text });
  const result = await page.evaluate(
    async ({ template, event }) => {
      const legacy = await new Promise((resolve, reject) => {
        const request = indexedDB.open('octopus-recordings', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('sessions', { keyPath: 'id' });
          request.result
            .createObjectStore('events', { keyPath: ['sessionId', 'seq'] })
            .createIndex('session', 'sessionId');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = reject;
      });
      await new Promise((resolve, reject) => {
        const tx = legacy.transaction(['sessions', 'events'], 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = reject;
        tx.objectStore('sessions').put(template);
        tx.objectStore('events').put(event);
      });
      legacy.close();
      const repository = new window.RecorderRepositoryTest.RecordingRepository();
      const preserved = await repository.get(template.id);
      const preservedEvents = await repository.events(template.id);
      for (let index = 0; index < 45; index++) {
        await repository.save({
          ...template,
          id: crypto.randomUUID(),
          name: `分页边界 ${index}`,
          startedAt: template.startedAt + 100 + index,
          recentEvents: [],
          count: 0,
        });
      }
      const first = await repository.page();
      await repository.delete(first.items.at(-1).id);
      const insertedId = crypto.randomUUID();
      await repository.save({ ...template, id: insertedId, startedAt: template.startedAt + 10000 });
      const ids = first.items.map((item) => item.id);
      let cursor = first.nextCursor;
      while (cursor) {
        const next = await repository.page('', cursor);
        ids.push(...next.items.map((item) => item.id));
        cursor = next.nextCursor;
      }
      const expiredId = crypto.randomUUID();
      const activeId = crypto.randomUUID();
      const expiredAt = Date.now() - 31 * 86400000;
      await repository.save({ ...template, id: expiredId, updatedAt: expiredAt }, [
        { ...event, id: crypto.randomUUID(), sessionId: expiredId },
      ]);
      await repository.save({ ...template, id: activeId, status: 'paused', updatedAt: expiredAt });
      await repository.prune(Date.now());
      const expiredRemoved =
        !(await repository.get(expiredId)) && (await repository.events(expiredId)).length === 0;
      const activePreserved = (await repository.get(activeId))?.status === 'paused';
      return {
        preservedId: preserved.id,
        preservedEvent: preservedEvents[0].id,
        count: ids.length,
        unique: new Set(ids).size,
        insertedInOldCursor: ids.includes(insertedId),
        expiredRemoved,
        activePreserved,
      };
    },
    { template, event }
  );
  assert.equal(result.preservedId, template.id);
  assert.equal(result.preservedEvent, event.id);
  assert.equal(result.count, 46);
  assert.equal(result.unique, 46);
  assert.equal(result.insertedInOldCursor, false);
  assert.equal(result.expiredRemoved, true);
  assert.equal(result.activePreserved, true);
  return result;
}

/**
 * Seeds isolated local evidence and verifies real indexed cursor reads, full search and preserved UI position.
 */
async function verifyPagination(worker, popup, evidence, template) {
  const longId = '00000000-0000-4000-8000-000000000000';
  await worker.evaluate(async (source) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('octopus-recordings');
      r.onsuccess = () => resolve(r.result);
      r.onerror = reject;
    });
    const base = Date.now();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = reject;
      for (let index = 0; index < 125; index++) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        let name = `分页记录 ${String(index).padStart(3, '0')}`;
        if (index === 0) {
          name = '长流程分页';
        }
        if (index === 124) {
          name = '远端匹配记录';
        }
        const session = {
          ...source,
          id,
          name,
          startedAt: base - Math.floor(index / 3) * 1000,
          status: 'stopped',
          count: 0,
          actionCount: 0,
          recentEvents: [],
          gaps: [],
        };
        if (index === 0) {
          session.count = 123;
          session.actionCount = 123;
        }
        tx.objectStore('sessions').put(session);
        if (index === 0) {
          for (let seq = 1; seq <= 123; seq++) {
            tx.objectStore('events').put({
              sessionId: id,
              seq,
              id: crypto.randomUUID(),
              at: base + seq,
              action: 'click',
              label: `操作 ${seq}`,
              url: 'http://example.test/',
              source: 'dom',
              documentId: 'fixture',
              tabRef: source.pages[0].tabRef,
            });
          }
        }
      }
    });
    db.close();
    await chrome.storage.local.set({ recordingRevision: crypto.randomUUID() });
  }, template);
  await popup.getByRole('button', { name: '返回录制记录', exact: true }).click();
  await expect(popup.getByRole('button', { name: /分页记录|长流程分页/ })).toHaveCount(5);
  await verifyFixedFrame(popup, '录制首页内容');
  const recentRow = popup.getByRole('button', { name: /分页记录/ }).first();
  await recentRow.scrollIntoViewIfNeeded();
  const originalColor = await recentRow.evaluate((element) => getComputedStyle(element).backgroundColor);
  await recentRow.hover();
  await expect
    .poll(() => recentRow.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(originalColor);
  await expect(recentRow).toHaveCSS('cursor', 'pointer');
  await popup.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(popup.locator('html')).toHaveClass(/dark/);
  await expect
    .poll(() => recentRow.evaluate((element) => getComputedStyle(element).color))
    .toBe(await popup.locator('main').evaluate((element) => getComputedStyle(element).color));
  await popup.screenshot({ path: join(evidence, 'recording-home-hover-dark.png') });
  await popup.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await recentRow.focus();
  await recentRow.press('Tab');
  await popup.keyboard.press('Shift+Tab');
  await expect(recentRow).toBeFocused();
  await expect(recentRow).toHaveCSS('outline-width', '2px');
  await recentRow.press('Enter');
  await expect(popup.getByRole('heading', { name: '录制详情', exact: true })).toBeVisible();
  await expect(popup.getByText('暂无已保存的操作', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: '返回录制记录', exact: true }).click();
  await popup.getByRole('button', { name: '查看全部', exact: true }).click();
  await expect(popup.getByText('已加载 20 条', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(popup.getByText('已加载 40 条', { exact: true })).toBeVisible();
  const list = popup
    .getByLabel('录制记录列表', { exact: true })
    .locator('[data-slot="scroll-area-viewport"]');
  await verifyFixedFrame(popup, '录制记录列表', '全部记录');
  await list.evaluate((element) => {
    element.scrollTop = 300;
  });
  const selectedRow = list.getByRole('button').nth(5);
  await selectedRow.scrollIntoViewIfNeeded();
  const beforeScroll = await list.evaluate((element) => element.scrollTop);
  await selectedRow.click();
  await expect(popup.getByRole('heading', { name: '录制详情', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: '返回录制记录', exact: true }).click();
  await expect(popup.getByText('已加载 40 条', { exact: true })).toBeVisible();
  assert.equal(await list.evaluate((element) => element.scrollTop), beforeScroll);
  await popup.getByLabel('搜索全部录制', { exact: true }).fill('远端匹配');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list.getByRole('button', { name: /远端匹配记录/ })).toBeVisible();
  await expect(popup.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
  await list.getByRole('button').click();
  await popup.getByRole('button', { name: '返回录制记录', exact: true }).click();
  await expect(popup.getByLabel('搜索全部录制', { exact: true })).toHaveValue('远端匹配');
  await popup.getByLabel('搜索全部录制', { exact: true }).fill('不存在的记录');
  await expect(popup.getByText('未找到匹配的录制', { exact: true })).toBeVisible();
  await expect(popup.locator('[data-slot="empty"]')).toBeVisible();
  await expect(popup.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
  await popup.screenshot({ path: join(evidence, 'recording-empty.png') });
  await popup.getByRole('button', { name: '清空搜索', exact: true }).click();
  await expect(popup.getByText('已加载 20 条', { exact: true })).toBeVisible();
  await popup.getByLabel('搜索全部录制', { exact: true }).fill('长流程分页');
  await list.getByRole('button', { name: /长流程分页/ }).click();
  await expect(popup.locator('ol > li')).toHaveCount(50);
  await verifyFixedFrame(popup, '录制详情内容', '录制详情');
  await popup.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await popup.setViewportSize({ width: 360, height: 420 });
  await verifyFixedFrame(popup, '录制详情内容', '录制详情');
  await expect(popup.getByRole('button', { name: '删除录制', exact: true })).toBeInViewport();
  await popup.screenshot({ path: join(evidence, 'recording-detail-short-dark.png') });
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await popup.getByRole('button', { name: '加载更多步骤', exact: true }).click();
  await expect(popup.locator('ol > li')).toHaveCount(100);
  await popup.getByRole('button', { name: '加载更多步骤', exact: true }).click();
  await expect(popup.locator('ol > li')).toHaveCount(123);
  await expect(popup.getByRole('button', { name: '加载更多步骤', exact: true })).toHaveCount(0);
  await popup.getByRole('button', { name: '返回录制记录', exact: true }).click();
  await popup.getByLabel('搜索全部录制', { exact: true }).fill('');
  await expect(popup.getByText('已加载 20 条', { exact: true })).toBeVisible();
  await popup.screenshot({ path: join(evidence, 'recording-all.png') });
  const result = await popup.evaluate(async (longId) => {
    const first = await chrome.runtime.sendMessage({ type: 'recorder.list', query: '', cursor: null });
    const mismatch = await chrome.runtime.sendMessage({
      type: 'recorder.list',
      query: 'changed',
      cursor: first.value.nextCursor,
    });
    let page = first.value;
    const ids = [...page.items.map((item) => item.id)];
    const sizes = [page.items.length];
    while (page.nextCursor) {
      const reply = await chrome.runtime.sendMessage({
        type: 'recorder.list',
        query: '',
        cursor: page.nextCursor,
      });
      if (!reply.ok) {
        throw new Error(reply.error);
      }
      page = reply.value;
      sizes.push(page.items.length);
      ids.push(...page.items.map((item) => item.id));
    }
    return { sizes, ids, mismatch: mismatch.ok, foundLong: ids.includes(longId) };
  }, longId);
  assert.equal(result.ids.length, 126);
  assert.equal(new Set(result.ids).size, 126);
  assert.deepEqual(result.sizes, [20, 20, 20, 20, 20, 20, 6]);
  assert.equal(result.mismatch, false);
  assert.equal(result.foundLong, true);
  return { count: result.ids.length, sizes: result.sizes, preservedScroll: beforeScroll };
}

/**
 * Checks the actual ScrollArea viewport while proving that branding, tabs and page navigation stay fixed.
 */
async function verifyFixedFrame(popup, label, title) {
  await verifyPopupContentBounds(popup, label);
  const viewport = popup.getByLabel(label, { exact: true }).locator('[data-slot="scroll-area-viewport"]');
  const targets = [
    popup.getByRole('heading', { name: 'Dr.Octopus', exact: true }),
    popup.getByRole('tablist'),
  ];
  if (title) {
    targets.push(popup.getByRole('heading', { name: title, exact: true }));
  }
  const before = await Promise.all(targets.map((target) => target.boundingBox()));
  const overflow = await viewport.evaluate((element) => element.scrollHeight > element.clientHeight);
  assert.equal(overflow, true, `${label} fixture must actually overflow`);
  await viewport.evaluate((element) => {
    element.scrollTop = 240;
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const after = await Promise.all(targets.map((target) => target.boundingBox()));
  assert.deepEqual(after, before, `${label}: fixed regions must not move with content`);
  const outer = await popup.evaluate(() => ({
    top: document.scrollingElement.scrollTop,
    mainHeight: document.querySelector('main').getBoundingClientRect().height,
    viewportHeight: innerHeight,
  }));
  assert.equal(outer.top, 0);
  assert.ok(outer.mainHeight <= outer.viewportHeight, `${label}: app frame must fit the available viewport`);
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
}
