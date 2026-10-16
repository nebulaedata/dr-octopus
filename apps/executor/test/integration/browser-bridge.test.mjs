/**
 * @author Codex
 * @description Verifies real isolated MV3 Native Messaging through the production launcher, Utility Runtime and desktop consent UI.
 */
import { downloadCreatedConfiguration } from './client-configuration.mjs';
import { createBrowserHostFixture } from './browser-host.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { browserIdentity } from '../../build/browser-identity.ts';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { _electron as electron, chromium, expect } from '@playwright/test';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { networkAddressSchema } from '../../src/contracts/connection-settings.ts';
const run = promisify(execFile);
const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
/**
 * Waits for actual extension storage changes under one finite test deadline.
 */
async function waitStatus(worker, expected) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const status = await worker.evaluate(
      async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus
    );
    if (status === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('Extension did not reach status: ' + expected);
}
test(
  'real Chrome/Edge bundles connect, disconnect and reconnect with finite browser capability independent of the window',
  { timeout: 180000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-browser-electron-'));
    const data = join(root, 'data');
    await mkdir(data);
    const transportKind = process.env.EXECUTOR_MCP_TRANSPORT ?? 'http';
    assert.ok(['http', 'stdio', 'remote-http'].includes(transportKind), 'Unknown MCP validation transport.');
    if (transportKind === 'remote-http') {
      const networkAddress = Object.values(networkInterfaces())
        .flat()
        .find(
          (item) =>
            item &&
            !item.internal &&
            item.family === 'IPv4' &&
            networkAddressSchema.safeParse(item.address).success
        )?.address;
      assert.ok(networkAddress, 'Browser network validation requires an assigned private/VPN IPv4 address.');
      const probe = createServer();
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
      });
      const port = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      const settings = await ConnectionSettings.open(
        new NativeFileCommit(join(appRoot, 'dist/native/file-commit.node')),
        join(data, 'project')
      );
      await settings.save({ port, networkAddress });
    }
    const { resource, register, extensionDirectory } = await createBrowserHostFixture({
      root,
      appRoot,
      userData: data,
    });
    let registered = false;
    let app;
    let client;
    const site = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        `<title>Octopus owned Browser fixture</title><body style="min-height:4000px"><button id="click">Fixture click</button><input aria-label="Fixture input"><select aria-label="Fixture select"><option>One</option><option>Two</option></select><input type="password" value="private-secret-password"><div data-executor-sensitive>private-sensitive-content</div><div id="big" style="height:80px;overflow:hidden">${request.url === '/big' ? 'pagination Unicode 中文 '.repeat(6000) : 'fixture text'}</div><script>globalThis.clicks=0;document.querySelector("#click").onclick=()=>globalThis.clicks++;</script></body>`
      );
    });
    site.listen(0, '127.0.0.1');
    await once(site, 'listening');
    const siteUrl = 'http://octopus-browser.test:' + site.address().port;
    const contexts = [];
    /**
     * Uses the real registration script, which refuses any pre-existing foreign Host entry before mutation.
     */
    try {
      await register('install');
      registered = true;
      app = await electron.launch({
        cwd: appRoot,
        args: [appRoot, '--executor-test', '--executor-test-data=' + data],
      });
      let page = await app.firstWindow();
      page.setDefaultTimeout(20000);
      await page.getByRole('heading', { name: 'MCP 服务已启动', exact: true }).waitFor();
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      await page.getByRole('button', { name: '启用浏览器桥接', exact: true }).click();
      await page.getByRole('button', { name: '关闭浏览器桥接', exact: true }).waitFor();
      const workers = [];
      const browserFlavor = process.env.EXECUTOR_BROWSER_FLAVOR ?? 'chromium';
      assert.ok(['chromium', 'installed'].includes(browserFlavor), 'Unknown browser validation flavor.');
      for (const browser of ['chrome', 'edge']) {
        const extension = await extensionDirectory(browser);
        let executablePath = join(
          process.env.LOCALAPPDATA,
          'ms-playwright/chromium-1228/chrome-win64/chrome.exe'
        );
        if (browserFlavor === 'installed') {
          executablePath =
            browser === 'chrome'
              ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
              : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
        }
        const context = await chromium.launchPersistentContext(join(root, browser), {
          executablePath,
          headless: false,
          ignoreDefaultArgs: ['--disable-back-forward-cache', '--disable-extensions'],
          chromiumSandbox: true,
          args: [
            ...(browserFlavor === 'installed'
              ? ['--enable-unsafe-extension-debugging']
              : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]),
            '--window-position=-2000,-2000',
            '--host-resolver-rules=MAP octopus-browser.test 127.0.0.1',
            '--no-proxy-server',
          ],
        });
        contexts.push(context);
        if (browserFlavor === 'installed') {
          assert.ok(
            context.browser(),
            'The installed-browser test must own its browser-level debugging channel.'
          );
          const debuggerSession = await context.browser().newBrowserCDPSession();
          try {
            const installed = await debuggerSession.send('Extensions.loadUnpacked', { path: extension });
            assert.equal(installed.id, browserIdentity.sideloadExtensionId);
            const version = await debuggerSession.send('Browser.getVersion');
            console.info('Owned installed-browser validation:', browser, version.product, version.revision);
          } finally {
            await debuggerSession.detach();
          }
        }
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        workers.push(worker);
        await waitStatus(worker, 'connected');
      }
      await page.waitForFunction(
        async () =>
          (await window.executor.readAccess()).data?.browser.connections.filter(
            (item) => item.state === 'connected'
          ).length === 2
      );
      const endpoint = (await page.evaluate(() => window.executor.readAccess())).data.endpoint;
      await page.waitForFunction(
        async () => (await window.executor.readStatus()).data?.capabilities.browser.available === true
      );
      const bridge = page.getByRole('region', { name: '浏览器桥接设置' });
      const connectedBadges = bridge.getByRole('button', { name: '已连接', exact: true });
      await expect(connectedBadges).toHaveCount(2);
      await expect(bridge.getByText('工具就绪 · 网站权限逐次校验', { exact: true })).toHaveCount(0);
      const readyExplanation = page.getByRole('tooltip');
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].show();
        BrowserWindow.getAllWindows()[0].focus();
      });
      await bridge.getByRole('button', { name: '关闭浏览器桥接', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(connectedBadges.first()).toBeFocused();
      await expect(readyExplanation).toHaveText('浏览器工具已就绪；每次操作都会校验当前网站的访问权限。');
      await expect(connectedBadges.first()).toHaveAttribute('aria-describedby', /.+/);
      await connectedBadges.first().press('Escape');
      await expect(readyExplanation).toHaveCount(0);
      const status = (await page.evaluate(() => window.executor.readStatus())).data;
      const before = (await page.evaluate(() => window.executor.readAccess())).data.browser.connections;
      assert.deepEqual(before.map((item) => item.browser).sort(), ['chrome', 'edge']);
      const diagnostics = await page.evaluate(() => window.executor.browserDiagnostics());
      assert.equal(diagnostics.ok, true);
      assert.equal(diagnostics.data.resourcesAvailable, true);
      assert.equal(diagnostics.data.projectRoot, join(data, 'project'));
      const workspace = join(root, 'workspace');
      await mkdir(workspace);
      const output = join(root, 'browser-client.json');
      await app.evaluate(
        ({ dialog }, values) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.workspace] });
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.output });
        },
        { workspace, output }
      );
      await page.getByRole('button', { name: '创建授权', exact: true }).click();
      await page.getByRole('checkbox', { name: '控制浏览器网页', exact: true }).check();
      await page.getByRole('dialog').getByRole('button', { name: '创建授权', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '授权已创建' }).waitFor();
      await downloadCreatedConfiguration(page, transportKind);
      const config = Object.values(JSON.parse(await readFile(output, 'utf8')).mcpServers)[0];
      if (transportKind === 'remote-http') {
        const access = (await page.evaluate(() => window.executor.readAccess())).data;
        assert.equal(config.url, access.remoteEndpoint);
        assert.equal(
          (await fetch(config.url.replace('/mcp', '/browser-bridge'), { headers: config.headers })).status,
          404
        );
      }
      client = new Client({ name: 'browser-production-test', version: '1' });
      let mcpTransport;
      if (transportKind === 'stdio') {
        mcpTransport = new StdioClientTransport({ ...config, stderr: 'pipe' });
        mcpTransport.stderr.resume();
      } else {
        mcpTransport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
        });
      }
      await client.connect(mcpTransport);
      /**
       * Validates actual MCP envelopes from the production authority rather than calling extension internals.
       */
      const call = async (name, args = {}) => {
        const reply = await client.callTool({ name, arguments: args });
        assert.notEqual(reply.isError, true, JSON.stringify(reply));
        return reply.structuredContent.data;
      };
      assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'browser_click'));
      assert.equal(
        (await client.listTools()).tools.some((tool) => tool.name.startsWith('computer_')),
        false
      );
      const ambiguous = await client.callTool({
        name: 'task_start',
        arguments: { capabilities: ['browser'], idempotencyKey: 'ambiguous' },
      });
      assert.equal(ambiguous.structuredContent.data.error.code, 'BROWSER_SELECTION_REQUIRED');
      const connectionId = before.find((item) => item.browser === 'chrome').connectionId;
      const task = await call('task_start', {
        capabilities: ['browser'],
        connectionId,
        idempotencyKey: 'browser-task',
      });
      const common = { taskId: task.taskId };
      const created = await call('browser_open_tab', { ...common, url: siteUrl, idempotencyKey: 'open' });
      let fixture;
      const tabDeadline = Date.now() + 10000;
      while (!fixture && Date.now() < tabDeadline) {
        fixture = contexts[0].pages().find((value) => value.url() === siteUrl + '/');
        if (!fixture) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      assert.ok(fixture);
      await fixture.waitForURL(siteUrl + '/');
      await fixture.waitForLoadState('load');
      assert.equal(
        await fixture.evaluate(() => isSecureContext),
        false,
        'The owned HTTP origin must not inherit localhost secure-context exceptions.'
      );
      const listedTabs = await call('browser_tabs', { connectionId });
      assert.ok(listedTabs.tabs.some((tab) => tab.tabId === created.tabId));
      const temporaryTab = await call('browser_open_tab', {
        ...common,
        url: siteUrl + '/close',
        idempotencyKey: 'open-close-fixture',
      });
      const temporaryDeadline = Date.now() + 10000;
      while (Date.now() < temporaryDeadline) {
        if (
          (await workers[0].evaluate((id) => chrome.tabs.get(id), temporaryTab.tabId)).status === 'complete'
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const tabClosed = await call('browser_close_tab', {
        ...common,
        tabId: temporaryTab.tabId,
        idempotencyKey: 'close-owned',
      });
      assert.equal(tabClosed.code, 'TAB_CLOSED');
      assert.equal(
        (await call('browser_tabs', { connectionId })).tabs.some((tab) => tab.tabId === temporaryTab.tabId),
        false
      );
      /**
       * Uses published element indices without accessing the controller's private mapping.
       */
      const target = (snapshot, label) => {
        const line = snapshot.text
          .split('\n')
          .find((value) => value.includes(label) && /\[\d+\]/.test(value));
        assert.ok(line, snapshot.text);
        return {
          documentId: snapshot.documentId,
          controllerId: snapshot.controllerId,
          snapshotId: snapshot.snapshotId,
          elementIndex: Number(line.match(/\[(\d+)\]/)[1]),
        };
      };
      const snapshot = async () => call('browser_snapshot', { ...common, tabId: created.tabId });
      const rawObserved = await client.callTool({
        name: 'browser_snapshot',
        arguments: { ...common, tabId: created.tabId },
      });
      assert.equal(rawObserved.isError, undefined);
      const observed = rawObserved.structuredContent.data;
      const captured = rawObserved.content.find((block) => block.type === 'image');
      assert.ok(captured, 'Browser snapshots must deliver a real MCP image block');
      assert.equal(captured.mimeType, 'image/jpeg');
      assert.ok(Buffer.from(captured.data, 'base64').length <= 131072);
      assert.equal(observed.image, undefined, 'Image must not be duplicated in structured metadata');
      const imagePath = join(tmpdir(), 'octopus-browser-snapshot-' + randomUUID() + '.jpg');
      await writeFile(imagePath, Buffer.from(captured.data, 'base64'));
      console.info('Captured MCP screenshot:', imagePath);
      assert.equal(observed.text.includes('private-secret-password'), false);
      assert.equal(observed.text.includes('private-sensitive-content'), false);
      await call('browser_click', {
        ...common,
        tabId: created.tabId,
        target: target(observed, 'Fixture click'),
        idempotencyKey: 'click',
      });
      assert.equal(await fixture.evaluate(() => globalThis.clicks), 1);
      const retained = await call('browser_click', {
        ...common,
        tabId: created.tabId,
        target: target(observed, 'Fixture click'),
        idempotencyKey: 'click',
      });
      assert.equal(retained.retained, true);
      assert.equal(await fixture.evaluate(() => globalThis.clicks), 1);
      const stale = await client.callTool({
        name: 'browser_click',
        arguments: {
          ...common,
          tabId: created.tabId,
          target: target(observed, 'Fixture click'),
          idempotencyKey: 'old',
        },
      });
      assert.equal(stale.structuredContent.data.error.code, 'SNAPSHOT_EXPIRED');
      const fill = await snapshot();
      const filled = await call('browser_fill', {
        ...common,
        tabId: created.tabId,
        target: target(fill, 'Fixture input'),
        text: 'literal 中文{Enter}',
        idempotencyKey: 'fill',
      });
      assert.equal(JSON.stringify(filled).includes('literal'), false);
      assert.equal(await fixture.locator('input').first().inputValue(), 'literal 中文{Enter}');
      const select = await snapshot();
      await call('browser_select', {
        ...common,
        tabId: created.tabId,
        target: target(select, 'Fixture select'),
        optionText: 'Two',
        idempotencyKey: 'select',
      });
      assert.equal(await fixture.locator('select').inputValue(), 'Two');
      const scroll = await snapshot();
      await call('browser_scroll', {
        ...common,
        tabId: created.tabId,
        target: {
          documentId: scroll.documentId,
          controllerId: scroll.controllerId,
          snapshotId: scroll.snapshotId,
        },
        direction: 'down',
        pixels: 150,
        idempotencyKey: 'scroll',
      });
      assert.ok((await fixture.evaluate(() => scrollY)) > 0);
      await fixture.evaluate(() => scrollTo(0, 0));
      const dirty = await snapshot();
      await fixture.evaluate(() => (document.querySelector('#click').textContent = 'Changed button'));
      const denied = await client.callTool({
        name: 'browser_click',
        arguments: {
          ...common,
          tabId: created.tabId,
          target: target(dirty, 'Fixture click'),
          idempotencyKey: 'dirty',
        },
      });
      assert.equal(denied.structuredContent.data.businessEffect, 'applied');
      assert.equal(
        await fixture.evaluate(() => globalThis.clicks),
        2,
        'Same-document text changes follow the upstream indexed element reference'
      );
      const documentSnapshot = await snapshot();
      await fixture.evaluate(() => {
        globalThis.restoredFromBFCache = false;
        addEventListener('pageshow', (event) => {
          globalThis.restoredFromBFCache = event.persisted;
        });
      });
      await fixture.goto(siteUrl + '/other');
      const oldDocument = await client.callTool({
        name: 'browser_click',
        arguments: {
          ...common,
          tabId: created.tabId,
          target: target(documentSnapshot, 'Changed button'),
          idempotencyKey: 'old-document',
        },
      });
      assert.equal(oldDocument.structuredContent.data.error.code, 'TARGET_CHANGED');
      await fixture.goBack({ waitUntil: 'commit' });
      await fixture.waitForFunction(() => globalThis.restoredFromBFCache === true);
      const restoredDocument = await snapshot();
      assert.notEqual(restoredDocument.controllerId, documentSnapshot.controllerId);
      await fixture.evaluate(() => history.pushState({}, '', '/spa'));
      const spa = await client.callTool({
        name: 'browser_scroll',
        arguments: {
          ...common,
          tabId: created.tabId,
          target: {
            documentId: restoredDocument.documentId,
            controllerId: restoredDocument.controllerId,
            snapshotId: restoredDocument.snapshotId,
          },
          direction: 'down',
          pixels: 1,
          idempotencyKey: 'spa-old',
        },
      });
      assert.equal(spa.structuredContent.data.error.code, 'TARGET_CHANGED');
      const roundTrip = await snapshot();
      await fixture.evaluate(() => {
        history.pushState({}, '', '/roundtrip');
        history.pushState({}, '', '/spa');
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const returnedUrl = await client.callTool({
        name: 'browser_scroll',
        arguments: {
          ...common,
          tabId: created.tabId,
          target: {
            documentId: roundTrip.documentId,
            controllerId: roundTrip.controllerId,
            snapshotId: roundTrip.snapshotId,
          },
          direction: 'down',
          pixels: 1,
          idempotencyKey: 'roundtrip-old',
        },
      });
      assert.equal(returnedUrl.structuredContent.data.error.code, 'TARGET_CHANGED');
      await fixture.evaluate(() => {
        const frame = document.createElement('iframe');
        frame.srcdoc = '<button>Frame button</button>';
        document.body.prepend(frame);
      });
      await fixture.waitForFunction(() =>
        document.querySelector('iframe')?.contentDocument?.querySelector('button')
      );
      const frameSnapshot = await snapshot();
      assert.ok(frameSnapshot.text.includes('Frame button'));
      await fixture.evaluate(() => {
        document.querySelector('iframe').contentDocument.querySelector('button').textContent =
          'Frame changed';
      });
      const frameDirty = await client.callTool({
        name: 'browser_click',
        arguments: {
          ...common,
          tabId: created.tabId,
          target: target(frameSnapshot, 'Frame button'),
          idempotencyKey: 'frame-dirty',
        },
      });
      assert.equal(frameDirty.structuredContent.data.businessEffect, 'applied');
      await fixture.evaluate(() => document.querySelector('iframe').remove());
      const protectedTab = await workers[0].evaluate(() =>
        chrome.tabs.create({ url: 'chrome://version', active: false })
      );
      const protectedReply = await client.callTool({
        name: 'browser_snapshot',
        arguments: { ...common, tabId: protectedTab.id },
      });
      assert.equal(protectedReply.structuredContent.data.error.code, 'FORBIDDEN_PAGE');
      await workers[0].evaluate((id) => chrome.tabs.remove(id), protectedTab.id);
      await call('browser_navigate', {
        ...common,
        tabId: created.tabId,
        url: siteUrl + '/big',
        idempotencyKey: 'navigate',
      });
      await fixture.waitForURL(siteUrl + '/big');
      const large = await snapshot();
      assert.equal(large.hasMore, true);
      let cursor = large.nextCursor;
      let full = large.text;
      let count = 1;
      while (cursor) {
        const next = await call('browser_read_snapshot', { ...common, cursor });
        full += next.text;
        cursor = next.nextCursor;
        count++;
      }
      assert.equal(count, large.pages);
      assert.equal(Buffer.byteLength(full), large.totalBytes);
      assert.equal(
        (await import('node:crypto')).createHash('sha256').update(full).digest('hex'),
        large.digest
      );
      await call('task_end', common);
      await expect(fixture.locator('#page-agent-runtime_simulator-mask')).toHaveCount(0);
      if (browserFlavor === 'installed') {
        const edgeConnection = (await call('browser_list')).connections.find(
          (item) => item.browser === 'edge' && item.state === 'connected'
        );
        assert.ok(edgeConnection);
        const edgeTask = await call('task_start', {
          capabilities: ['browser'],
          connectionId: edgeConnection.connectionId,
          idempotencyKey: 'edge-owned-task',
        });
        const edgeCommon = { taskId: edgeTask.taskId };
        const edgeTab = await call('browser_open_tab', {
          ...edgeCommon,
          url: siteUrl + '/edge',
          idempotencyKey: 'edge-open',
        });
        const edgePageDeadline = Date.now() + 10000;
        let edgePage;
        while (!edgePage && Date.now() < edgePageDeadline) {
          edgePage = contexts[1].pages().find((value) => value.url() === siteUrl + '/edge');
          if (!edgePage) {
            await new Promise((accept) => setTimeout(accept, 50));
          }
        }
        assert.ok(edgePage);
        await edgePage.waitForLoadState('load');
        /**
         * Obtains a fresh production snapshot from the explicitly selected Edge connection.
         */
        const edgeSnapshot = async () => {
          const raw = await client.callTool({
            name: 'browser_snapshot',
            arguments: { ...edgeCommon, tabId: edgeTab.tabId },
          });
          assert.ok(
            raw.content.some((block) => block.type === 'image' && block.mimeType === 'image/jpeg'),
            'Edge must return a screenshot image'
          );
          assert.equal(raw.isError, undefined);
          return raw.structuredContent.data;
        };
        await call('browser_click', {
          ...edgeCommon,
          tabId: edgeTab.tabId,
          target: target(await edgeSnapshot(), 'Fixture click'),
          idempotencyKey: 'edge-click',
        });
        assert.equal(await edgePage.evaluate(() => globalThis.clicks), 1);
        await call('browser_fill', {
          ...edgeCommon,
          tabId: edgeTab.tabId,
          target: target(await edgeSnapshot(), 'Fixture input'),
          text: 'Edge 中文{Enter}',
          idempotencyKey: 'edge-fill',
        });
        assert.equal(await edgePage.locator('input').first().inputValue(), 'Edge 中文{Enter}');
        await call('browser_select', {
          ...edgeCommon,
          tabId: edgeTab.tabId,
          target: target(await edgeSnapshot(), 'Fixture select'),
          optionText: 'Two',
          idempotencyKey: 'edge-select',
        });
        assert.equal(await edgePage.locator('select').inputValue(), 'Two');
        const edgeScroll = await edgeSnapshot();
        await call('browser_scroll', {
          ...edgeCommon,
          tabId: edgeTab.tabId,
          target: {
            documentId: edgeScroll.documentId,
            controllerId: edgeScroll.controllerId,
            snapshotId: edgeScroll.snapshotId,
          },
          direction: 'down',
          pixels: 150,
          idempotencyKey: 'edge-scroll',
        });
        assert.ok((await edgePage.evaluate(() => scrollY)) > 0);
        await call('browser_navigate', {
          ...edgeCommon,
          tabId: edgeTab.tabId,
          url: siteUrl + '/edge-next',
          idempotencyKey: 'edge-navigate',
        });
        await edgePage.waitForURL(siteUrl + '/edge-next');
        await call('browser_close_tab', {
          ...edgeCommon,
          tabId: edgeTab.tabId,
          idempotencyKey: 'edge-close',
        });
        await call('task_end', edgeCommon);
        await expect(edgePage.locator('#page-agent-runtime_simulator-mask')).toHaveCount(0);
      }
      await workers[0].evaluate(() => chrome.storage.local.set({ paused: true }));
      await waitStatus(workers[0], 'paused');
      await page.waitForFunction(
        async () =>
          (await window.executor.readAccess()).data?.browser.connections.filter(
            (item) => item.state === 'connected'
          ).length === 1
      );
      await workers[0].evaluate(() => chrome.storage.local.set({ paused: false }));
      await waitStatus(workers[0], 'connected');
      await page.waitForFunction(
        async () =>
          (await window.executor.readAccess()).data?.browser.connections.filter(
            (item) => item.state === 'connected'
          ).length === 2
      );
      const after = (await page.evaluate(() => window.executor.readAccess())).data.browser.connections;
      assert.notEqual(
        after.find((item) => item.browser === 'chrome').connectionId,
        before.find((item) => item.browser === 'chrome').connectionId
      );
      const beforeReloadConnection = (await call('browser_list')).connections.find(
        (item) => item.browser === 'chrome' && item.state === 'connected'
      ).connectionId;
      const beforeReloadTask = await call('task_start', {
        capabilities: ['browser'],
        connectionId: beforeReloadConnection,
        idempotencyKey: 'before-reload',
      });
      const beforeReloadSnapshot = await call('browser_snapshot', {
        taskId: beforeReloadTask.taskId,
        tabId: created.tabId,
      });
      const workerControl = await contexts[0].newCDPSession(fixture);
      await workerControl.send('ServiceWorker.enable');
      await workerControl.send('ServiceWorker.stopAllWorkers');
      await workerControl.detach();
      await page.waitForFunction(
        async (old) =>
          (await window.executor.readAccess()).data.browser.connections.some(
            (item) => item.browser === 'chrome' && item.state === 'connected' && item.connectionId !== old
          ),
        beforeReloadConnection
      );
      const afterReload = await client.callTool({
        name: 'browser_snapshot',
        arguments: { taskId: beforeReloadTask.taskId, tabId: created.tabId },
      });
      assert.equal(afterReload.structuredContent.data.error.code, 'BROWSER_OFFLINE');
      await call('task_stop', { taskId: beforeReloadTask.taskId });
      let refreshed;
      const reconnectDeadline = Date.now() + 70000;
      while (Date.now() < reconnectDeadline) {
        refreshed = (await call('browser_list')).connections.find(
          (item) =>
            item.browser === 'chrome' &&
            item.state === 'connected' &&
            item.connectionId !== beforeReloadConnection
        );
        if (refreshed) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.ok(refreshed, JSON.stringify((await call('browser_list')).connections));
      const newTask = await call('task_start', {
        capabilities: ['browser'],
        connectionId: refreshed.connectionId,
        idempotencyKey: 'new-document-task',
      });
      const restored = await call('browser_snapshot', { taskId: newTask.taskId, tabId: created.tabId });
      assert.notEqual(restored.controllerId, beforeReloadSnapshot.controllerId);
      assert.notEqual(restored.snapshotId, large.snapshotId);
      const closeForeign = await client.callTool({
        name: 'browser_close_tab',
        arguments: { taskId: newTask.taskId, tabId: created.tabId, idempotencyKey: 'foreign-close' },
      });
      assert.equal(closeForeign.structuredContent.data.error.code, 'FORBIDDEN');
      await call('task_end', { taskId: newTask.taskId });
      const management = await contexts[0].newPage();
      await management.goto('chrome://extensions');
      const ownExtension = management
        .locator('extensions-item')
        .filter({ hasText: 'Octopus Browser Bridge' });
      await ownExtension.locator('#enableToggle').click();
      await page.waitForFunction(
        async () =>
          !(await window.executor.readAccess()).data.browser.connections.some(
            (item) => item.browser === 'chrome' && item.state === 'connected'
          )
      );
      await ownExtension.locator('#enableToggle').click();
      let enabledConnection;
      const enableDeadline = Date.now() + 20000;
      while (Date.now() < enableDeadline) {
        enabledConnection = (await call('browser_list')).connections.find(
          (item) =>
            item.browser === 'chrome' &&
            item.state === 'connected' &&
            item.connectionId !== refreshed.connectionId
        );
        if (enabledConnection) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(enabledConnection);
      const enabledWorker = contexts[0]
        .serviceWorkers()
        .find((worker) =>
          worker.url().startsWith(`chrome-extension://${browserIdentity.sideloadExtensionId}/`)
        );
      assert.ok(enabledWorker);
      const hasReceiver = await enabledWorker.evaluate(
        async ({ tabId, connectionId }) => {
          try {
            await chrome.tabs.sendMessage(tabId, { type: 'page.ping', connectionId }, { frameId: 0 });
            return true;
          } catch (error) {
            if (/Receiving end does not exist|Could not establish connection/.test(error.message)) {
              return false;
            }
            throw error;
          }
        },
        { tabId: created.tabId, connectionId: enabledConnection.connectionId }
      );
      assert.equal(
        hasReceiver,
        false,
        'Existing documents must have no receiver before this real recovery check.'
      );
      const injectionDebug = await contexts[0].newCDPSession(fixture);
      let injections = 0;
      injectionDebug.on('Debugger.scriptParsed', (event) => {
        if (event.url.endsWith('/content-scripts/content.js')) {
          injections++;
        }
      });
      await injectionDebug.send('Debugger.enable');
      injections = 0;
      const injectionTask = await call('task_start', {
        capabilities: ['browser'],
        connectionId: enabledConnection.connectionId,
        idempotencyKey: 'receiver-restored',
      });
      const injected = await call('browser_snapshot', { taskId: injectionTask.taskId, tabId: created.tabId });
      assert.equal(
        injections,
        1,
        'Exactly one fixed content script is injected after a harmless missing-receiver probe.'
      );
      await injectionDebug.detach();
      assert.notEqual(injected.controllerId, restored.controllerId);
      await ownExtension.locator('#detailsButton').click();
      const siteAccess = management.locator('extensions-runtime-host-permissions').locator('#hostAccess');
      await siteAccess.selectOption('ON_CLICK');
      const permissionDenied = await client.callTool({
        name: 'browser_click',
        arguments: {
          taskId: injectionTask.taskId,
          tabId: created.tabId,
          target: target(injected, 'Fixture click'),
          idempotencyKey: 'site-revoked',
        },
      });
      assert.equal(permissionDenied.structuredContent.data.error.code, 'FORBIDDEN_PAGE');
      await siteAccess.selectOption('ON_ALL_SITES');
      const permissionRestored = await call('browser_snapshot', {
        taskId: injectionTask.taskId,
        tabId: created.tabId,
      });
      assert.ok(permissionRestored.snapshotId);
      await call('task_end', { taskId: injectionTask.taskId });
      await management.close();
      const closed = page.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].destroy();
      });
      await closed;
      assert.doesNotThrow(() => process.kill(status.pid, 0));
      const recreated = app.waitForEvent('window');
      await app.evaluate(({ app }) => {
        app.emit('activate');
      });
      page = await recreated;
      await page.waitForFunction(
        async () =>
          (await window.executor.readAccess()).data?.browser.connections.filter(
            (item) => item.state === 'connected'
          ).length === 2
      );
      assert.equal((await page.evaluate(() => window.executor.readStatus())).data.pid, status.pid);
      await app.close();
      app = null;
      await waitStatus(workers[1], 'disconnected');
      await assert.rejects(fetch(endpoint.replace('/mcp', '/browser-bridge')));
      const hostDeadline = Date.now() + 10000;
      let hostCount;
      do {
        const probe = await run(
          powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='browser-launcher.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('" +
              resource.replaceAll("'", "''") +
              "\\') }).Count",
          ],
          { windowsHide: true }
        );
        hostCount = Number(probe.stdout.trim());
        if (hostCount === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < hostDeadline);
      assert.equal(hostCount, 0, 'Only this isolated package Native Hosts must exit after Runtime shutdown.');
    } finally {
      await client?.close().catch(() => {});
      await Promise.allSettled(contexts.map((context) => context.close()));
      site.closeAllConnections();
      await new Promise((resolve) => site.close(resolve));
      await app?.close().catch(() => {});
      if (registered) {
        await register('remove');
      }
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-browser-electron-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
