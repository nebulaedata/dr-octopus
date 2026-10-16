/**
 * @author Codex
 * @description Validates browser-action popup rendering and real pause/resume behavior in isolated installed Chrome/Edge profiles without changing Host registration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
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
        await expect(popup.getByText('未连接', { exact: true })).toBeVisible();
        await expect(popup.getByText('未就绪', { exact: true })).toBeVisible();
        await expect(popup.getByText(flavor === 'chrome' ? /Google Chrome/ : /Microsoft Edge/)).toBeVisible();
        await expect(popup.getByText(/检查 Executor 与浏览器 Host 注册/)).toBeVisible();
        assert.equal(await popup.locator('vite-error-overlay').count(), 0);
        assert.equal(
          await popup.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth),
          true
        );
        await popup.getByRole('button', { name: '暂停连接', exact: true }).click();
        await expect(popup.getByText('已暂停', { exact: true })).toBeVisible();
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
        await expect(reopened.getByText('已暂停', { exact: true })).toBeVisible();
        await reopened.getByRole('button', { name: '恢复连接', exact: true }).click();
        await expect(reopened.getByText('未连接', { exact: true })).toBeVisible();
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
        assert.deepEqual(errors, []);
      } finally {
        await context?.close();
        assert.ok(temporary.startsWith(join(tmpdir(), 'octopus-popup-')));
        await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  );
}
