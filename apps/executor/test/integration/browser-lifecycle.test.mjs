/**
 * @author Codex
 * @description Verifies real frozen/discarded tabs through production MCP with no debugger attached to the website.
 */
import { downloadCreatedConfiguration } from './client-configuration.mjs';
import { createBrowserHostFixture } from './browser-host.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { _electron as electron } from '@playwright/test';
import { launchDetachedBrowser } from './detached-browser.mjs';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const { identity: browserIdentity } = JSON.parse(
  await readFile(new URL('../../dist/browser-identity.json', import.meta.url), 'utf8')
);
const extensionId = browserIdentity.sideloadExtensionId;

/**
 * Waits for a browser-owned observable state under a finite deadline; never fabricates lifecycle state.
 */
async function waitFor(read, accept, label) {
  const deadline = Date.now() + 20000;
  let value;
  do {
    value = await read();
    if (accept(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(label + ': ' + JSON.stringify(value));
}

/**
 * Selects only the fixture's exposed element reference from the real published snapshot.
 */
function target(snapshot) {
  const line = snapshot.text
    .split('\n')
    .find((line) => line.includes('Fixture click') && /\[\d+\]/.test(line));
  assert.ok(line, snapshot.text);
  return {
    documentId: snapshot.documentId,
    controllerId: snapshot.controllerId,
    snapshotId: snapshot.snapshotId,
    elementIndex: Number(line.match(/\[(\d+)\]/)[1]),
  };
}

// Internal pages use shadow DOM. These expressions only inspect the owned control tab.
const deepElements = `const all = []; function visit(root) {
  for (const element of root.querySelectorAll('*')) {
    all.push(element); if (element.shadowRoot) visit(element.shadowRoot);
  }
} visit(document);`;

for (const browserName of ['chrome', 'edge']) {
  test(
    browserName +
      ' detached website tabs refuse frozen/discarded execution and restore without action replay',
    { timeout: 120000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'octopus-browser-lifecycle-'));
      const data = join(root, 'data');
      await mkdir(data);
      const { register, extensionDirectory } = await createBrowserHostFixture({
        root,
        appRoot,
        userData: data,
      });
      let app;
      let browser;
      let client;
      let registered = false;
      let loads = 0;
      let clicks = 0;
      const site = createServer((request, response) => {
        if (request.url === '/clicked') {
          clicks++;
          response.end('ok');
          return;
        }
        if (request.url === '/fixture') {
          loads++;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(
          '<title>Octopus lifecycle fixture</title><button onclick="fetch(\'/clicked\')">Fixture click</button>'
        );
      });
      site.listen(0, '127.0.0.1');
      await once(site, 'listening');
      const siteUrl = 'http://octopus-browser.test:' + site.address().port + '/fixture';
      try {
        await register('install');
        registered = true;
        app = await electron.launch({
          cwd: appRoot,
          args: [appRoot, '--executor-test', '--executor-test-data=' + data],
        });
        const page = await app.firstWindow();
        page.setDefaultTimeout(20000);
        await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
        await page.getByRole('tab', { name: '连接', exact: true }).click();
        await page.getByRole('button', { name: '启用浏览器桥接', exact: true }).click();
        browser = await launchDetachedBrowser(
          join(root, browserName),
          await extensionDirectory(browserName),
          browserName
        );
        const version = await browser.send('Browser.getVersion');
        console.info('Detached lifecycle browser:', browserName, version.product, version.revision);
        const { targetId: control } = await browser.send('Target.createTarget', {
          url: 'chrome-extension://' + extensionId + '/licenses/page-controller-1.12.4.txt',
        });
        await waitFor(
          () => browser.evaluate(control, 'typeof chrome.tabs'),
          (value) => value === 'object',
          'Extension control ready'
        );
        const connection = await waitFor(
          async () => (await page.evaluate(() => window.executor.readAccess())).data.browser.connections,
          (connections) => connections.some((item) => item.state === 'connected'),
          'Real bridge connection'
        );
        const connectionId = connection.find((item) => item.state === 'connected').connectionId;
        const workspace = join(root, 'workspace');
        const output = join(root, 'mcp.json');
        await mkdir(workspace);
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
        await downloadCreatedConfiguration(page);
        const config = Object.values(JSON.parse(await readFile(output, 'utf8')).mcpServers)[0];
        client = new Client({ name: 'browser-lifecycle-test', version: '1' });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
        );
        /**
         * Requires production MCP success, including task authorization and bridge envelopes.
         */
        const call = async (name, args) => {
          const reply = await client.callTool({ name, arguments: args });
          assert.notEqual(reply.isError, true, JSON.stringify(reply));
          return reply.structuredContent.data;
        };
        const task = await call('task_start', {
          capabilities: ['browser'],
          connectionId,
          idempotencyKey: 'lifecycle-task',
        });
        const common = { taskId: task.taskId };
        const created = await call('browser_open_tab', {
          ...common,
          url: siteUrl,
          idempotencyKey: 'lifecycle-open',
        });
        let tabId = created.tabId;
        /**
         * Reads browser-owned metadata from a separate extension tab without attaching to the website.
         */
        const readTab = () => browser.evaluate(control, `chrome.tabs.get(${tabId})`);
        await waitFor(readTab, (tab) => tab.status === 'complete', 'Website load');
        const keeper = await browser.evaluate(
          control,
          `(async () => {
        const tab=await chrome.tabs.get(${tabId});
        return chrome.tabs.create({windowId:tab.windowId,url:'about:blank',active:true});
      })()`
        );
        const { targetId: website } = (await browser.send('Target.getTargets')).targetInfos.find(
          (item) => item.url === siteUrl
        );
        assert.equal(
          (await browser.send('Target.getTargetInfo', { targetId: website })).targetInfo.attached,
          false
        );
        const { targetId: internal } = await browser.send('Target.createTarget', {
          url: 'chrome://chrome-urls',
        });
        await waitFor(
          () =>
            browser.evaluate(
              internal,
              `(() => { ${deepElements}
            return all.some(element => element.textContent.includes('://discards'));
          })()`
            ),
          (value) => value === true,
          'Owned debug index rendered'
        );
        await browser.evaluate(
          internal,
          `(() => { ${deepElements}
        const button = all.find(element => element.matches('button, cr-button, [role="button"]') && /Enable internal debugging pages|启用.*调试页面/.test(element.textContent));
        if (button) button.click(); })()`
        );
        await waitFor(
          () =>
            browser.evaluate(
              internal,
              `(() => { ${deepElements}
            return all.some(element => element.matches('a') && (element.getAttribute('href') || '').includes('://discards'));
          })()`
            ),
          (value) => value === true,
          'Owned internal debug pages enabled'
        );
        await browser.evaluate(internal, 'location.href="chrome://discards"');
        for (const state of ['frozen', 'discarded']) {
          const previous = await call('browser_snapshot', { ...common, tabId });
          const previousTabId = tabId;
          const previousLoads = loads;
          await browser.evaluate(control, `chrome.tabs.update(${keeper.id}, {active:true})`);
          assert.equal((await readTab()).active, false, 'Website must be a real background tab.');
          await browser.send('Target.activateTarget', { targetId: internal });
          if (state === 'frozen') {
            await waitFor(
              () =>
                browser.evaluate(
                  internal,
                  `(() => { ${deepElements}
            const row = all.find(element => element.tagName === 'TR' && [...element.querySelectorAll('td')].some(cell=>cell.textContent.trim()===${JSON.stringify(siteUrl)}));
            const action = row && [...row.querySelectorAll('[is="action-link"]')].find(element => element.textContent.trim() === '[Freeze]');
            if (action) { action.click(); return {clicked:true}; }
            return {clicked:false, url:location.href, row:row?.outerHTML, candidates:all.filter(element=>element.tagName==='TR' && element.innerText.includes(${JSON.stringify(siteUrl)})).map(element=>element.outerHTML).join(' | ').slice(0,8000)}; })()`
                ),
              (value) => value.clicked,
              'Freeze owned row'
            );
          } else {
            const discarded = await browser.evaluate(control, `chrome.tabs.discard(${tabId})`);
            assert.equal(discarded.discarded, true);
            assert.ok(Number.isSafeInteger(discarded.id));
            tabId = discarded.id;
            console.info('Discard handle:', browserName, { previousTabId, tabId });
          }
          await waitFor(readTab, (tab) => tab[state] === true, 'Real ' + state);
          // A detached website may lose its target on discard; metadata was proved before discard.
          if (state === 'frozen') {
            assert.equal(
              (await browser.send('Target.getTargetInfo', { targetId: website })).targetInfo.attached,
              false
            );
          }
          for (const method of ['browser_snapshot', 'browser_click']) {
            const args = { ...common, tabId: previousTabId };
            if (method === 'browser_click') {
              args.target = target(previous);
              args.idempotencyKey = state + '-refused';
            }
            const reply = await client.callTool({ name: method, arguments: args });
            assert.equal(reply.isError, true);
            assert.equal(
              reply.structuredContent.data.error.code,
              tabId === previousTabId ? 'TAB_NOT_EXECUTABLE' : 'TARGET_CHANGED',
              JSON.stringify(reply)
            );
          }
          if (tabId !== previousTabId) {
            const rediscovered = await call('browser_tabs', { connectionId });
            assert.equal(
              rediscovered.tabs.some((tab) => tab.tabId === previousTabId),
              false
            );
            assert.equal(
              rediscovered.tabs.some((tab) => tab.tabId === tabId),
              true
            );
            const unavailable = await client.callTool({
              name: 'browser_snapshot',
              arguments: { ...common, tabId },
            });
            assert.equal(unavailable.isError, true);
            assert.equal(unavailable.structuredContent.data.error.code, 'TAB_NOT_EXECUTABLE');
          }
          assert.equal((await readTab())[state], true, 'Refusal must preserve browser lifecycle state.');
          assert.equal(loads, previousLoads, 'Refusal must not reload the website.');
          assert.equal(clicks, 0, 'Refused action must not execute.');
          if (state === 'frozen') {
            await browser.resume(website);
          } else {
            await browser.evaluate(control, `chrome.tabs.reload(${tabId})`);
          }
          await waitFor(
            readTab,
            (tab) => !tab[state] && tab.status === 'complete',
            'Explicit recovery restores tab'
          );
          if (state === 'discarded') {
            const oldDocument = await client.callTool({
              name: 'browser_click',
              arguments: {
                ...common,
                tabId: previousTabId,
                target: target(previous),
                idempotencyKey: 'discarded-old-document',
              },
            });
            assert.equal(oldDocument.isError, true);
            assert.equal(oldDocument.structuredContent.data.error.code, 'TARGET_CHANGED');
            assert.equal(clicks, 0);
          }
          const restored = await call('browser_snapshot', { ...common, tabId });
          assert.notEqual(restored.snapshotId, previous.snapshotId);
          if (state === 'discarded') {
            assert.notEqual(restored.controllerId, previous.controllerId);
            assert.notEqual(restored.documentId, previous.documentId);
            assert.equal(loads, previousLoads + 1, 'Only explicit user reload restores a discarded tab.');
          } else {
            assert.equal(restored.documentId, previous.documentId);
            assert.equal(loads, previousLoads);
          }
          const obsolete = await client.callTool({
            name: 'browser_click',
            arguments: {
              ...common,
              tabId,
              target: target(previous),
              idempotencyKey: state + '-obsolete',
            },
          });
          assert.equal(obsolete.isError, true);
          assert.equal(obsolete.structuredContent.data.error.code, 'SNAPSHOT_EXPIRED');
          assert.equal(clicks, 0);
          console.info(
            'Lifecycle verified:',
            state,
            'real refusal, explicit recovery, stale reference rejection'
          );
        }
        await browser.evaluate(
          control,
          `(async () => {
          const tab=await chrome.tabs.update(${tabId}, {active:true});
          await chrome.windows.update(tab.windowId, {focused:true,left:80,top:80});
        })()`
        );
        const fresh = await waitFor(
          () => call('browser_snapshot', { ...common, tabId }),
          (snapshot) =>
            snapshot.text.split('\n').some((line) => line.includes('Fixture click') && /\[\d+\]/.test(line)),
          'Explicitly visible restored page exposes real element references'
        );
        assert.equal(clicks, 0, 'Recovery must not replay either refused action.');
        await call('browser_click', {
          ...common,
          tabId,
          target: target(fresh),
          idempotencyKey: 'fresh-click',
        });
        await waitFor(
          async () => clicks,
          (value) => value === 1,
          'Fresh action executes exactly once'
        );
        await call('task_end', common);
        await client.close();
        client = undefined;
      } finally {
        const cleanup = await Promise.allSettled([client?.close(), browser?.close(), app?.close()]);
        site.closeAllConnections();
        await new Promise((resolve) => site.close(resolve));
        if (registered) {
          await register('remove');
        }
        assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\octopus-browser-lifecycle-'));
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        for (const result of cleanup) {
          assert.equal(result.status, 'fulfilled', String(result.reason));
        }
      }
    }
  );
}
