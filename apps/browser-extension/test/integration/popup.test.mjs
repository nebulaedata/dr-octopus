/**
 * @author Codex
 * @description Validates browser-action popup rendering and real pause/resume behavior in isolated installed Chrome/Edge profiles without changing Host registration.
 */
import { verifyPopupContentBounds } from './popup-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
/* global chrome */

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const flavor of ['chrome', 'edge']) {
  test(
    `installed ${flavor}: actual action popup, pause persistence, resume and offline diagnostics`,
    { timeout: 60000 },
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), 'octopus-popup-'));
      let context;
      try {
        const extension = join(temporary, 'extension');
        await cp(join(root, '.output', flavor + '-mv3'), extension, { recursive: true });
        const { identity, profile } = JSON.parse(
          await readFile(join(extension, 'browser-identity.json'), 'utf8')
        );
        if (profile === 'store') {
          // This owned UI-only copy uses the development key; it is not store/Native Host acceptance.
          const manifestPath = join(extension, 'manifest.json');
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          await writeFile(manifestPath, JSON.stringify({ ...manifest, key: identity.sideloadPublicKey }));
        }
        // Only the owned copy points to an unregistered test Host; all popup and worker logic remains production code.
        const background = join(extension, 'background.js');
        const source = await readFile(background, 'utf8');
        assert.equal(source.split('com.octopus.executor.browser').length, 2);
        await writeFile(
          background,
          source.replace('com.octopus.executor.browser', 'com.octopus.test.popup_unregistered')
        );
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
        let worker = context.serviceWorkers().find((entry) => entry.url().includes(id));
        if (!worker) {
          worker = await context.waitForEvent('serviceworker');
        }
        await expect
          .poll(() =>
            worker.evaluate(async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus)
          )
          .toBe('native_host_unavailable');
        await worker.evaluate(async () => chrome.action.openPopup());
        const { targetInfos } = await cdp.send('Target.getTargets');
        const popupTarget = targetInfos.find(
          (target) => target.url === `chrome-extension://${id}/popup.html`
        );
        assert.ok(popupTarget, 'Browser action must open the real popup target.');
        const dimensions = await inspectActionPopup(cdp, popupTarget.targetId);
        console.log(`${flavor} actual action popup: ${JSON.stringify(dimensions)}`);
        assert.equal(dimensions.width, 360);
        assert.equal(dimensions.height, 600);
        assert.equal(dimensions.bodyHeight, 600);
        assert.ok(
          dimensions.mainHeight >= 590,
          'actual action popup must not collapse to the initial viewport'
        );
        await cdp.send('Target.closeTarget', { targetId: popupTarget.targetId });
        // The native toolbar popup is discoverable by CDP but is not delivered by this context's page event.
        // After verifying the actual action target, exercise the same production popup in an owned extension tab.
        const popup = await context.newPage();
        await popup.setViewportSize({ width: 360, height: 600 });
        const errors = [];
        popup.on('pageerror', (error) => errors.push(error.message));
        popup.on('console', (message) => {
          if (message.type() === 'error') {
            errors.push(message.text());
          }
        });
        await popup.goto(`chrome-extension://${id}/popup.html`);
        const decodedIcons = await popup.evaluate(async () => {
          const manifest = chrome.runtime.getManifest();
          return Promise.all(
            Object.entries(manifest.icons).map(async ([size, path]) => {
              const icon = new Image();
              icon.src = chrome.runtime.getURL(path);
              await icon.decode();
              return {
                size: Number(size),
                width: icon.naturalWidth,
                height: icon.naturalHeight,
                actionPath: manifest.action.default_icon[size],
                path,
              };
            })
          );
        });
        assert.equal(decodedIcons.length, 4);
        for (const icon of decodedIcons) {
          assert.equal(icon.width, icon.size);
          assert.equal(icon.height, icon.size);
          assert.equal(icon.actionPath, icon.path);
        }
        await expect(popup).toHaveTitle('Dr.Octopus 浏览器连接');
        assert.equal(popup.url(), `chrome-extension://${id}/popup.html`);
        await expect(popup.getByRole('heading', { name: 'Dr.Octopus', exact: true })).toBeVisible();
        await expect(popup.getByRole('tab').first()).toHaveText('连接状态');
        await expect(popup.getByRole('tab', { name: '连接状态', exact: true })).toHaveAttribute(
          'aria-selected',
          'true'
        );
        await expect(popup.getByText('未连接', { exact: true })).toBeVisible();

        const dot = popup.locator('[data-slot="connection-status-dot"]');
        await expect(dot).toHaveClass(/bg-destructive/);
        await expect(dot).toHaveAttribute('aria-label', '连接失败');
        await popup.getByRole('tab', { name: '录制重放', exact: true }).click();
        await expect(dot).toBeVisible();
        await popup.getByRole('tab', { name: '连接状态', exact: true }).click();

        await expect(popup.getByText('未就绪', { exact: true })).toBeVisible();
        await expect(popup.getByText(flavor === 'chrome' ? /Google Chrome/ : /Microsoft Edge/)).toBeVisible();
        await expect(popup.getByText(/检查 Executor 与浏览器 Host 注册/)).toBeVisible();
        assert.equal(await popup.locator('vite-error-overlay').count(), 0);
        assert.equal(
          await popup.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth),
          true
        );
        // Controlled live Worker reply: stale stored labels are not used to paint the successful dot.
        await popup.evaluate(() => {
          const original = chrome.runtime.sendMessage.bind(chrome.runtime);
          window.restoreStatusPeer = () => {
            chrome.runtime.sendMessage = original;
          };
          chrome.runtime.sendMessage = async (request) => {
            const reply = await original(request);
            if (request.type === 'bridge.status') {
              return {
                ...reply,
                phase: 'connected',
                code: '',
                toolsReady: true,
                lastConnectedAt: new Date().toISOString(),
              };
            }
            return reply;
          };
        });
        await popup.getByRole('tab', { name: '录制重放', exact: true }).click();
        await expect(dot).toHaveAttribute('aria-label', '连接成功');
        await expect(dot).toHaveClass(/bg-success/);
        await expect(dot).toBeVisible();
        await popup.getByRole('tab', { name: '连接状态', exact: true }).click();
        const connectedBadge = popup.locator('[data-slot="badge"]').filter({ hasText: /^已连接$/ });
        await expect(connectedBadge).toHaveClass(/bg-success\/10/);
        await expect(connectedBadge).toHaveClass(/text-success/);
        const readyBadge = popup.locator('[data-slot="badge"]').filter({ hasText: /^已就绪$/ });
        await expect(readyBadge).toHaveClass(/bg-primary/);
        await expect(readyBadge).toHaveClass(/text-primary-foreground/);
        await expect(popup.getByText('最近一次连接', { exact: true })).toBeVisible();
        await expect(popup.getByText(/^今天 \d{2}:\d{2}$/)).toBeVisible();
        const diagnostics = popup.locator('details').filter({ hasText: '连接诊断' });
        await expect(diagnostics).not.toHaveAttribute('open');
        await expect(popup.getByText('最近一次连接异常', { exact: true })).toBeHidden();
        if (process.env.OCTOPUS_POPUP_EVIDENCE_DIR) {
          await popup.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
          await expect(popup.locator('html')).toHaveClass('dark');
          await mkdir(process.env.OCTOPUS_POPUP_EVIDENCE_DIR, { recursive: true });
          await popup.screenshot({
            path: join(process.env.OCTOPUS_POPUP_EVIDENCE_DIR, `${flavor}-connected.png`),
          });
        }
        await diagnostics.locator('summary').click();
        await expect(popup.getByText('最近一次连接异常', { exact: true })).toBeVisible();
        await expect(popup.locator('footer[aria-label="扩展信息"]')).toBeInViewport();
        if (process.env.OCTOPUS_POPUP_EVIDENCE_DIR) {
          await popup.screenshot({
            path: join(process.env.OCTOPUS_POPUP_EVIDENCE_DIR, `${flavor}-diagnostics.png`),
          });
        }
        await popup.getByRole('button', { name: '暂停连接', exact: true }).scrollIntoViewIfNeeded();
        await expect(popup.getByRole('button', { name: '暂停连接', exact: true })).toBeInViewport();
        await popup.getByRole('tab', { name: '录制重放', exact: true }).click();
        await popup.evaluate(() => window.restoreStatusPeer());
        await popup.getByRole('tab', { name: '连接状态', exact: true }).click();
        await expect(dot).toHaveAttribute('aria-label', '连接失败');
        await popup.getByRole('button', { name: '暂停连接', exact: true }).click();
        await expect(popup.getByText('已暂停', { exact: true })).toBeVisible();
        await expect(dot).toHaveClass(/bg-muted-foreground/);
        await expect(dot).toHaveAttribute('aria-label', '连接已暂停');
        assert.equal(
          await worker.evaluate(async () => (await chrome.storage.local.get('paused')).paused),
          true
        );
        await expect(popup.getByRole('button', { name: '重新连接', exact: true })).toBeDisabled();
        await popup.close();
        assert.equal(
          await worker.evaluate(async () => (await chrome.storage.local.get('paused')).paused),
          true
        );
        // Reopening the popup document must preserve pause and use the same installation instance.
        const reopened = await context.newPage();
        await reopened.setViewportSize({ width: 360, height: 600 });
        await reopened.goto(`chrome-extension://${id}/popup.html`);
        await expect(reopened.getByRole('tab', { name: '连接状态', exact: true })).toHaveAttribute(
          'aria-selected',
          'true'
        );
        await expect(reopened.getByText('已暂停', { exact: true })).toBeVisible();
        await reopened.getByRole('button', { name: '恢复连接', exact: true }).click();
        await expect(reopened.getByText('未连接', { exact: true })).toBeVisible();
        await expect(reopened.getByText('尚无连接记录', { exact: true })).toBeVisible();
        await expect(reopened.getByText('最近一次连接异常', { exact: true })).toBeHidden();
        await reopened.locator('details').filter({ hasText: '连接诊断' }).locator('summary').click();
        await expect(reopened.getByText('最近一次连接异常', { exact: true })).toBeVisible();
        await expect(reopened.getByText('native_host_unavailable', { exact: true })).toBeVisible();
        const diagnostic = await worker.evaluate(
          async () => (await chrome.storage.local.get('bridgeLastFailure')).bridgeLastFailure
        );
        assert.equal(diagnostic.code, 'native_host_unavailable');
        assert.equal(diagnostic.nativeReason, 'host_not_found');
        await expect
          .poll(() => worker.evaluate(async () => (await chrome.storage.local.get('paused')).paused))
          .toBe(false);
        await reopened.getByRole('button', { name: '重新连接', exact: true }).click();
        await expect(reopened.getByText('未连接', { exact: true })).toBeVisible();
        await expect(reopened.getByRole('button', { name: '暂停连接', exact: true })).toBeEnabled();
        await reopened.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
        await expect(reopened.locator('html')).toHaveClass('dark');
        await expect(reopened.getByRole('button', { name: '重新连接', exact: true })).toBeEnabled();
        await verifyConnectionFooter(reopened, worker, flavor);
        assert.deepEqual(errors, []);
      } finally {
        await context?.close();
        assert.ok(temporary.startsWith(join(tmpdir(), 'octopus-popup-')));
        await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  );
}

/**
 * Tests copy outcomes without modifying the user's OS clipboard and verifies fixed metadata under overflow.
 */
async function verifyConnectionFooter(page, worker, flavor) {
  const evidence = await mkdtemp(join(tmpdir(), `octopus-connection-footer-${flavor}-`));
  const footer = page.locator('footer[aria-label="扩展信息"]');
  await expect(footer).toBeInViewport();
  assert.equal(await footer.locator('code').count(), 1);
  const id = await footer.locator('code').getAttribute('title');
  assert.match(id, /^[0-9a-f-]{36}$/);
  await expect(
    page
      .locator('[data-slot="badge"]')
      .filter({ hasText: /^未就绪$/ })
      .locator('svg')
  ).toHaveCount(1);
  const initial = await footer.boundingBox();
  assert.ok(Math.abs(initial.y + initial.height - 584) <= 1);
  await page.evaluate(() => {
    window.__copyFixture = { values: [], fail: false };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          if (window.__copyFixture.fail) {
            throw new Error('test denied');
          }
          window.__copyFixture.values.push(value);
        },
      },
    });
  });
  await page.getByRole('button', { name: '复制安装实例', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制安装实例', exact: true }).locator('svg')).toHaveClass(
    /text-success/
  );
  assert.deepEqual(await page.evaluate(() => window.__copyFixture.values), [id]);
  await page.screenshot({ path: join(evidence, 'copied-dark.png') });
  await expect(page.getByRole('button', { name: '复制安装实例', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__copyFixture.fail = true;
  });
  await page.getByRole('button', { name: '复制安装实例', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('复制失败，请重试。');
  await expect(page.getByRole('button', { name: '已复制安装实例', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.__copyFixture.fail = false;
  });
  await page.getByRole('button', { name: '复制安装实例', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制安装实例', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '复制安装实例', exact: true })).toBeVisible();
  await worker.evaluate(async () =>
    chrome.storage.local.set({
      bridgeLastFailure: {
        at: '2026-10-28T02:08:58.000Z',
        code: 'LONG_DIAGNOSTIC_'.repeat(4),
        method: 'browser_read_snapshot',
        nativeReason: 'native_error',
      },
    })
  );
  await expect(page.getByText('LONG_DIAGNOSTIC_'.repeat(4), { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 420 });
  const viewport = page
    .getByLabel('Executor 连接内容', { exact: true })
    .locator('[data-slot="scroll-area-viewport"]');
  await verifyPopupContentBounds(page, 'Executor 连接内容');
  assert.ok(await viewport.evaluate((element) => element.scrollHeight > element.clientHeight));
  const before = await footer.boundingBox();
  const headerBefore = await page.getByRole('heading', { name: 'Dr.Octopus', exact: true }).boundingBox();
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  assert.deepEqual(await footer.boundingBox(), before);
  assert.deepEqual(
    await page.getByRole('heading', { name: 'Dr.Octopus', exact: true }).boundingBox(),
    headerBefore
  );
  await expect(footer).toBeInViewport();
  const title = await page.getByText('最近一次连接异常', { exact: true }).boundingBox();
  const time = await page.locator('time').boundingBox();
  assert.ok(Math.abs(title.y - time.y) < 2);
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-10-28T02:08:58.000Z');
  await page.screenshot({ path: join(evidence, 'short-overflow-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: join(evidence, 'short-overflow-light.png') });
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify(
      {
        clipboard: 'controlled adapter; OS clipboard untouched',
        completeIdCopied: true,
        feedbackReset: true,
        failureHandled: true,
        footerFixed: true,
        titleTimeSameRow: true,
      },
      null,
      2
    )
  );
  console.log(`Connection footer evidence: ${evidence}`);
}

/**
 * Measures the real toolbar action document rather than a tab with an externally assigned viewport.
 */
async function inspectActionPopup(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cdp.off('Target.receivedMessageFromTarget', receive);
        reject(new Error('Popup inspection timed out'));
      }, 5000);
      /**
       * Matches only this finite inspection reply and removes its listener on every result.
       */
      const receive = (event) => {
        if (event.sessionId !== sessionId) {
          return;
        }
        const message = JSON.parse(event.message);
        if (message.id !== 1) {
          return;
        }
        clearTimeout(timer);
        cdp.off('Target.receivedMessageFromTarget', receive);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message)));
        } else {
          resolve(message.result.result.value);
        }
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
      void cdp
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression: `(async () => { for (let i=0;i<50&&!document.querySelector('main');i++) await new Promise(r=>setTimeout(r,20)); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return {width:innerWidth,height:innerHeight,bodyHeight:document.body.getBoundingClientRect().height,mainHeight:document.querySelector('main')?.getBoundingClientRect().height}; })()`,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        })
        .catch((error) => {
          clearTimeout(timer);
          cdp.off('Target.receivedMessageFromTarget', receive);
          reject(error);
        });
    });
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId });
  }
}
