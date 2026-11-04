/**
 * @author Codex
 * @description Verifies installed Chrome/Edge through the actual development runner, managed Host, Utility Runtime and explicit desktop bridge consent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { createBrowserHostFixture } from './browser-host.mjs';
import { developmentBrowserRunner } from '../../../browser-extension/scripts/lib/development-browser.mjs';
import { configureBrowserHost } from '../../src/main/browser-installation.ts';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test(
  'managed Host connects both installed browsers to the actual Utility Runtime and closes without replay',
  { timeout: 120000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-browser-lifecycle-'));
    const data = join(root, 'data');
    await mkdir(data);
    const fixture = await createBrowserHostFixture({ root, appRoot, userData: data });
    let app;
    let runner;
    let registered = false;
    const startedAt = Date.now();
    let stage = 'created';
    /**
     * Retains the exact failing phase without logging credentials or page content.
     */
    function record(value) {
      stage = value;
      console.info(JSON.stringify({ stage, elapsedMs: Date.now() - startedAt }));
    }
    try {
      record('registering');
      await fixture.register('install');
      registered = true;
      record('registered');
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        cwd: appRoot,
        env,
        timeout: 30000,
        args: [appRoot, '--executor-test', `--executor-test-data=${data}`],
      });
      record('electron-launched');
      const page = await app.firstWindow();
      page.setDefaultTimeout(20000);
      const window = await app.browserWindow(page);
      await window.evaluate((owned) => {
        owned.show();
        owned.focus();
      });
      record('test-window-visible');
      await page.waitForFunction(
        async () => (await window.executor.readStatus()).data?.state === 'ready',
        undefined,
        { timeout: 30000 }
      );
      record('runtime-ready');
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      record('connection-page');
      await page.getByRole('switch', { name: '浏览器桥接', exact: true }).click();
      record('bridge-enabled');
      let owner = JSON.parse(await readFile(join(data, 'project/browser-host/state/owner.json'), 'utf8'));
      for (const browser of ['chrome', 'edge']) {
        const extension = await fixture.extensionDirectory(browser);
        const metadata = JSON.parse(await readFile(join(extension, 'browser-identity.json'), 'utf8'));
        runner = developmentBrowserRunner(
          { config: { browser, outDir: extension }, logger: { info: () => {} } },
          join(root, 'profiles')
        );
        await runner.openBrowser();
        record(`${browser}-opened`);
        await expect
          .poll(
            async () =>
              page.evaluate(
                async (flavor) =>
                  (await window.executor.readAccess()).data.browser.connections.find(
                    (item) => item.browser === flavor
                  )?.state,
                browser
              ),
            { timeout: 30000 }
          )
          .toBe('connected');
        record(`${browser}-connected`);
        const connection = await page.evaluate(
          async (flavor) =>
            (await window.executor.readAccess()).data.browser.connections.find(
              (item) => item.browser === flavor
            ),
          browser
        );
        assert.equal(connection.extensionBuildId, metadata.extensionBuildId);
        assert.equal(connection.hostBundleId, owner.bundleId);
        assert.equal(connection.toolsAvailable, true);
        assert.equal(metadata.protocolVersion, 5);
        if (browser === 'chrome') {
          record('publishing-updated-host');
          const inventoryPath = join(fixture.source, 'host-bundle.json');
          const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
          const [major, minor, patch] = inventory.version.split('.').map(Number);
          inventory.version = `${major}.${minor}.${patch + 1}`;
          await writeFile(inventoryPath, JSON.stringify(inventory));
          assert.equal((await configureBrowserHost(fixture.source, join(data, 'project'))).phase, 'ready');
          record('updated-host-published');
          owner = JSON.parse(await readFile(join(data, 'project/browser-host/state/owner.json'), 'utf8'));
          assert.notEqual(owner.bundleId, connection.hostBundleId);
          const stillActive = await page.evaluate(async () =>
            (await window.executor.readAccess()).data.browser.connections.find(
              (item) => item.browser === 'chrome'
            )
          );
          assert.equal(
            stillActive.hostBundleId,
            connection.hostBundleId,
            'Publishing a manifest does not pretend a running old Host changed code.'
          );
          await runner.closeBrowser();
          await expect
            .poll(
              async () =>
                page.evaluate(
                  async () =>
                    (await window.executor.readAccess()).data.browser.connections.find(
                      (item) => item.browser === 'chrome'
                    )?.state
                ),
              { timeout: 10000 }
            )
            .toBe('disconnected');
          await runner.openBrowser();
          record('chrome-reopened');
          await expect
            .poll(
              async () =>
                page.evaluate(
                  async () =>
                    (await window.executor.readAccess()).data.browser.connections.find(
                      (item) => item.browser === 'chrome'
                    )?.hostBundleId
                ),
              { timeout: 30000 }
            )
            .toBe(owner.bundleId);
          const reconnected = await page.evaluate(async () =>
            (await window.executor.readAccess()).data.browser.connections.find(
              (item) => item.browser === 'chrome'
            )
          );
          assert.equal(reconnected.installationId, connection.installationId);
          assert.notEqual(reconnected.connectionId, connection.connectionId);
          record('chrome-updated-host-connected');
        }
        if (browser === 'edge') {
          await window.evaluate((owned) => {
            owned.show();
            owned.focus();
          });
          const region = page.getByRole('region', { name: '浏览器桥接设置' });
          await expect(region.getByText(/^Edge ·/)).toBeVisible();
          await expect(region.getByText('已连接', { exact: true })).toBeVisible();
          if (process.env.EXECUTOR_GUI_SCREENSHOT) {
            await page.screenshot({ path: process.env.EXECUTOR_GUI_SCREENSHOT });
          }
          await region.getByRole('button', { name: '安装与连接说明', exact: true }).click();
          await expect(region.getByRole('button', { name: '修复浏览器连接', exact: true })).toHaveCount(0);
          await expect(region.getByRole('button', { name: '检查连接', exact: true })).toHaveCount(0);
          await expect(region.getByText(/安装版和解压版均无需手动配置/)).toBeVisible();
          record('connected-ui-verified');
        }
        await runner.closeBrowser();
        runner = undefined;
        await expect
          .poll(
            async () =>
              page.evaluate(
                async (flavor) =>
                  (await window.executor.readAccess()).data.browser.connections.find(
                    (item) => item.browser === flavor
                  )?.state,
                browser
              ),
            { timeout: 10000 }
          )
          .toBe('disconnected');
      }
    } catch (error) {
      console.error(JSON.stringify({ failedStage: stage, message: error.message }));
      throw error;
    } finally {
      record('cleanup');
      await runner?.closeBrowser();
      await app?.close();
      if (registered) {
        await fixture.register('remove');
      }
      await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      record('cleaned');
    }
  }
);
