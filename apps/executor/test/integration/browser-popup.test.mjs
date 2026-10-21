/**
 * @author Codex
 * @description Verifies the actual native action popup against an owned Native Host, production Utility Runtime and authorized MCP in installed Chrome/Edge.
 */
import { downloadCreatedConfiguration } from './client-configuration.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron, chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const { identity: browserIdentity } = JSON.parse(
  await readFile(new URL('../../dist/browser-identity.json', import.meta.url), 'utf8')
);
const extensionId = browserIdentity.sideloadExtensionId;
const interactive = process.env.EXECUTOR_POPUP_INTERACTIVE === '1';
const flavors = process.env.EXECUTOR_POPUP_BROWSER
  ? [process.env.EXECUTOR_POPUP_BROWSER]
  : ['chrome', 'edge'];
assert.ok(flavors.every((flavor) => ['chrome', 'edge'].includes(flavor)));
/* global chrome */

for (const flavor of flavors) {
  test(
    `installed ${flavor}: native popup, real Host, authorized MCP and lifetime`,
    { timeout: 600000 },
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), 'octopus-live-popup-'));
      const data = join(temporary, 'data');
      const resource = join(temporary, 'host');
      const extension = join(temporary, 'extension');
      const host = 'com.octopus.executor.popup_test_' + randomUUID().replaceAll('-', '');
      const manifest = join(resource, 'bridge/native-host.json');
      const registryScript = join(temporary, 'register.ps1');
      const report = { flavor, extensionVersion: '0.1.3', checks: [], passed: false };
      let app;
      let browser;
      let client;
      let registered = false;
      let clicks = 0;
      const site = createServer((request, response) => {
        if (request.url === '/effect') {
          clicks++;
          response.end('ok');
          return;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          `<title>Dr.Octopus popup acceptance · ${flavor}</title><body style="font-family:system-ui;padding:60px"><h1>Dr.Octopus popup acceptance · ${flavor}</h1><p>Owned browser test. No personal data.</p><button onclick="fetch('/effect')">Owned effect</button><input aria-label="Owned input"></body>`
        );
      });
      /**
       * Records only non-secret evidence for this fixture and its finite acceptance phases.
       */
      function record(check) {
        report.checks.push(check);
        writeFileSync(join(temporary, 'progress.json'), JSON.stringify(report, null, 2));
        console.info(JSON.stringify({ flavor, check, root: temporary }));
      }
      /**
       * Registers only the unique test key; removal requires the original owned manifest value.
       */
      async function register(mode) {
        await promisify(execFile)(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-File', registryScript, mode],
          {
            windowsHide: true,
            timeout: 10000,
            env: { ...process.env, OCTOPUS_POPUP_HOST: host, OCTOPUS_POPUP_MANIFEST: manifest },
          }
        );
      }
      /**
       * Reads process metadata only for the launcher/Node pair rooted in this temporary Host.
       */
      async function hostProcesses() {
        const { stdout } = await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'browser-launcher.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -and $_.CommandLine.Contains($env:OCTOPUS_POPUP_RESOURCE) } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress",
          ],
          {
            windowsHide: true,
            timeout: 10000,
            env: { ...process.env, OCTOPUS_POPUP_RESOURCE: resource },
          }
        );
        const values = stdout.trim() ? JSON.parse(stdout) : [];
        return Array.isArray(values) ? values : [values];
      }
      try {
        await mkdir(data);
        for (const path of [
          'native/browser-launcher.exe',
          'native/file-commit.node',
          'bridge/native-host.cjs',
          'resources/node/node.exe',
          'resources/node/LICENSE',
        ]) {
          await mkdir(join(resource, path, '..'), { recursive: true });
          await copyFile(join(root, 'dist', path), join(resource, path));
        }
        await writeFile(join(resource, 'bridge/host-location.json'), JSON.stringify({ projectRoot: join(data, 'project') }));
        await writeFile(
          manifest,
          JSON.stringify({
            name: host,
            description: 'Owned popup acceptance',
            path: join(resource, 'native/browser-launcher.exe'),
            type: 'stdio',
            allowed_origins: [`chrome-extension://${extensionId}/`],
          })
        );
        await writeFile(
          registryScript,
          `param([ValidateSet('install','remove')][string]$Mode)
$ErrorActionPreference = 'Stop'
if ($env:OCTOPUS_POPUP_HOST -notmatch '^com\\.octopus\\.executor\\.popup_test_[a-f0-9]{32}$') { throw 'Invalid test Host' }
$key = 'HKCU:\\Software\\${flavor === 'chrome' ? 'Google\\Chrome' : 'Microsoft\\Edge'}\\NativeMessagingHosts\\' + $env:OCTOPUS_POPUP_HOST
if ($Mode -eq 'install') {
  if (Test-Path -LiteralPath $key) { throw 'Test Host already exists' }
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $env:OCTOPUS_POPUP_MANIFEST
} elseif (Test-Path -LiteralPath $key) {
  if ((Get-Item -LiteralPath $key).GetValue('') -ne $env:OCTOPUS_POPUP_MANIFEST) { throw 'Foreign test Host value' }
  Remove-Item -LiteralPath $key
}
`
        );
        await cp(join(root, '../browser-extension/.output', flavor + '-mv3'), extension, { recursive: true });
        const background = join(extension, 'background.js');
        const original = await readFile(background, 'utf8');
        assert.equal(original.split('com.octopus.executor.browser').length, 2);
        await writeFile(background, original.replace('com.octopus.executor.browser', host));
        assert.equal(
          JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')).version,
          report.extensionVersion
        );
        await register('install');
        registered = true;
        app = await electron.launch({
          cwd: root,
          args: [root, '--executor-test', '--executor-test-data=' + data],
        });
        const page = await app.firstWindow();
        page.setDefaultTimeout(20000);
        await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
        await page.getByRole('tab', { name: '连接', exact: true }).click();
        await page.getByRole('switch', { name: '浏览器桥接', exact: true }).click();
        const configPath = join(temporary, 'client.json');
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => {
            throw new Error('Device consent must not select a workspace');
          };
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
        }, configPath);
        await page.getByRole('button', { name: '创建授权', exact: true }).click();
        await page.getByRole('checkbox', { name: '控制浏览器网页', exact: true }).check();
        await page.getByRole('dialog').getByRole('button', { name: '创建授权', exact: true }).click();
        await page.locator('[data-slot="toast"]').filter({ hasText: '授权已创建' }).waitFor();
        await downloadCreatedConfiguration(page, flavor === 'edge' ? 'stdio' : 'http');
        const config = Object.values(JSON.parse(await readFile(configPath, 'utf8')).mcpServers)[0];
        client = new Client({ name: 'owned-native-popup', version: '1' });
        const transport =
          flavor === 'chrome'
            ? new StreamableHTTPClientTransport(new URL(config.url), {
                requestInit: { headers: config.headers },
              })
            : new StdioClientTransport({ ...config, stderr: 'pipe' });
        transport.stderr?.resume();
        await client.connect(transport);
        await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
        const siteUrl = `http://127.0.0.1:${site.address().port}/`;
        /**
         * Calls the same production task/authorization entrypoint used by an agent.
         */
        async function call(name, args = {}) {
          const reply = await client.callTool({ name, arguments: args });
          assert.notEqual(reply.isError, true, JSON.stringify(reply));
          return reply.structuredContent.data;
        }
        browser = await chromium.launchPersistentContext(join(temporary, 'profile'), {
          executablePath:
            flavor === 'chrome'
              ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
              : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
          headless: false,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: [
            '--enable-unsafe-extension-debugging',
            '--force-renderer-accessibility',
            interactive ? '--window-position=80,80' : '--window-position=-2000,-2000',
            '--window-size=1180,800',
            '--no-first-run',
            '--no-default-browser-check',
          ],
        });
        const cdp = await browser.browser().newBrowserCDPSession();
        const landing = browser.pages()[0];
        await landing.goto(siteUrl);
        await landing.waitForLoadState('load');
        assert.equal(await landing.title(), `Dr.Octopus popup acceptance · ${flavor}`);
        assert.equal((await cdp.send('Extensions.loadUnpacked', { path: extension })).id, extensionId);
        const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
        await expect
          .poll(
            () => worker.evaluate(async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus),
            { timeout: 20000 }
          )
          .toBe('connected');
        report.browserVersion = browser.browser().version();
        const connection = (await call('browser_list')).connections.find(
          (entry) => entry.state === 'connected'
        );
        assert.ok(connection?.toolsAvailable);
        const tools = (await client.listTools()).tools;
        assert.equal(tools.filter((tool) => tool.name.startsWith('browser_')).length, 11);
        assert.equal(
          tools.some((tool) => tool.name.startsWith('computer_')),
          false
        );
        const task = await call('task_start', {
          capabilities: ['browser'],
          connectionId: connection.connectionId,
          idempotencyKey: 'before-pause',
        });
        const common = { taskId: task.taskId };
        const tab = await call('browser_open_tab', {
          ...common,
          url: siteUrl,
          idempotencyKey: 'open',
        });
        await expect
          .poll(() => worker.evaluate((id) => chrome.tabs.get(id).then((tab) => tab.status), tab.tabId))
          .toBe('complete');
        await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), tab.tabId);
        /**
         * Uses only the public snapshot reference, never Controller internals.
         */
        function target(snapshot) {
          const line = snapshot.text
            .split('\n')
            .find((line) => line.includes('Owned effect') && /\[\d+\]/.test(line));
          assert.ok(line);
          return {
            documentId: snapshot.documentId,
            controllerId: snapshot.controllerId,
            snapshotId: snapshot.snapshotId,
            elementIndex: Number(line.match(/\[(\d+)\]/)[1]),
          };
        }
        const observed = await call('browser_snapshot', { ...common, tabId: tab.tabId });
        await call('browser_click', {
          ...common,
          tabId: tab.tabId,
          target: target(observed),
          idempotencyKey: 'effect-before',
        });
        await expect.poll(() => clicks).toBe(1);
        record('real Host and authorized MCP effect once; Computer closed');
        if (interactive) {
          record('READY: click extension in owned browser toolbar menu, then pause and resume');
        } else {
          await worker.evaluate(() => chrome.action.openPopup());
        }
        let popupTarget;
        await expect
          .poll(
            async () => {
              const { targetInfos } = await cdp.send('Target.getTargets');
              popupTarget = targetInfos.find(
                (target) => target.url === `chrome-extension://${extensionId}/popup.html`
              );
              return Boolean(popupTarget);
            },
            { timeout: interactive ? 240000 : 10000 }
          )
          .toBe(true);
        const { sessionId } = await cdp.send('Target.attachToTarget', {
          targetId: popupTarget.targetId,
          flatten: false,
        });
        let popupSequence = 0;
        /**
         * Routes requests to the actual popup target; the browser-level Playwright CDP session accepts no target session argument.
         */
        async function popupCommand(method, params) {
          const id = ++popupSequence;
          let timer;
          let receive;
          const response = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Owned popup command timed out: ' + method)), 10000);
            /**
             * Settles only this request's reply from the owned popup session; unrelated target events are ignored.
             */
            receive = (event) => {
              if (event.sessionId !== sessionId) {
                return;
              }
              const message = JSON.parse(event.message);
              if (message.id !== id) {
                return;
              }
              if (message.error) {
                reject(new Error(JSON.stringify(message.error)));
              } else {
                resolve(message.result);
              }
            };
            cdp.on('Target.receivedMessageFromTarget', receive);
          });
          try {
            const [result] = await Promise.all([
              response,
              cdp.send('Target.sendMessageToTarget', {
                sessionId,
                message: JSON.stringify({ id, method, params }),
              }),
            ]);
            return result;
          } finally {
            clearTimeout(timer);
            cdp.off('Target.receivedMessageFromTarget', receive);
          }
        }
        /**
         * Reads the actual browser-action target; no extension-tab fallback is allowed.
         */
        async function popup(expression) {
          const reply = await popupCommand('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          assert.equal(reply.exceptionDetails, undefined, JSON.stringify(reply.exceptionDetails));
          return reply.result.value;
        }
        await expect.poll(() => popup('document.body.innerText')).toContain('已连接');
        assert.ok((await popup('document.body.innerText')).includes('就绪'));
        record('native popup shows real handshake and ready state');
        /**
         * Clicks the actual popup with CDP mouse events during unattended checks; interactive runs use Computer Use.
         */
        async function clickPopup(label) {
          const position = await popup(
            `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)}));if(!b||b.disabled)throw new Error('Button unavailable');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`
          );
          await popupCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            button: 'left',
            clickCount: 1,
            ...position,
          });
          await popupCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            button: 'left',
            clickCount: 1,
            ...position,
          });
        }
        if (!interactive) {
          await clickPopup('暂停连接');
        }
        await expect
          .poll(() => worker.evaluate(async () => (await chrome.storage.local.get('paused')).paused), {
            timeout: interactive ? 240000 : 10000,
          })
          .toBe(true);
        await expect.poll(() => popup('document.body.innerText')).toContain('已暂停');
        const refused = await client.callTool({
          name: 'browser_snapshot',
          arguments: { ...common, tabId: tab.tabId },
        });
        assert.equal(refused.isError, true);
        assert.equal(clicks, 1);
        record('native pause closes transport and rejects old task dispatch');
        if (!interactive) {
          await clickPopup('恢复连接');
        }
        await expect
          .poll(
            () => worker.evaluate(async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus),
            { timeout: interactive ? 240000 : 20000 }
          )
          .toBe('connected');
        await expect.poll(() => popup('document.body.innerText')).toContain('已连接');
        const restored = (await call('browser_list')).connections.find(
          (entry) => entry.state === 'connected'
        );
        assert.notEqual(restored.connectionId, connection.connectionId);
        assert.equal(restored.installationId, connection.installationId);
        assert.equal(clicks, 1);
        record('native resume creates new connection without replay');
        await cdp.send('Target.closeTarget', { targetId: popupTarget.targetId });
        await call('task_end', common);
        const freshTask = await call('task_start', {
          capabilities: ['browser'],
          connectionId: restored.connectionId,
          idempotencyKey: 'after-resume',
        });
        const fresh = { taskId: freshTask.taskId, tabId: tab.tabId };
        const old = await client.callTool({
          name: 'browser_click',
          arguments: { ...fresh, target: target(observed), idempotencyKey: 'old-reference' },
        });
        assert.equal(old.isError, true);
        const snapshot = await call('browser_snapshot', fresh);
        await call('browser_click', { ...fresh, target: target(snapshot), idempotencyKey: 'effect-after' });
        await expect.poll(() => clicks).toBe(2);
        await call('task_end', { taskId: freshTask.taskId });
        record('popup closed: fresh MCP action succeeds, old reference rejected');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        assert.ok(
          (await call('browser_list')).connections.some(
            (entry) => entry.connectionId === restored.connectionId && entry.state === 'connected'
          )
        );
        assert.equal((await hostProcesses()).length, 2);
        record('management window closed: bridge and Host stay alive');
        await client.close();
        client = null;
        await app.evaluate(({ app }) => app.quit());
        await app.close();
        app = null;
        await expect.poll(hostProcesses, { timeout: 15000 }).toEqual([]);
        await expect
          .poll(
            () => worker.evaluate(async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus),
            { timeout: 20000 }
          )
          .not.toBe('connected');
        report.passed = true;
        record('full Executor exit: owned Host converges and Worker disconnects');
      } catch (error) {
        report.failure = error.message;
        throw error;
      } finally {
        const cleanup = await Promise.allSettled([client?.close(), browser?.close(), app?.close()]);
        const cleanupFailures = cleanup
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason.message);
        try {
          if (registered) {
            await register('remove');
          }
        } catch (error) {
          cleanupFailures.push(error.message);
        }
        if (cleanupFailures.length) {
          report.cleanupFailures = cleanupFailures;
          report.passed = false;
        }
        await new Promise((resolve) => site.close(resolve));
        await writeFile(join(temporary, 'report.json'), JSON.stringify(report, null, 2));
        console.info(
          JSON.stringify({ flavor, report: join(temporary, 'report.json'), passed: report.passed })
        );
        await delay(100);
        assert.deepEqual(cleanupFailures, [], 'Owned fixture cleanup must complete');
      }
    }
  );
}
