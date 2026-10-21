/**
 * @author Codex
 * @description Verifies explicit network settings, private export and real MCP calls through built Main, Preload and Utility on isolated user data.
 */
import { createClientConfiguration } from './client-configuration.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { networkAddressSchema } from '../../src/contracts/connection-settings.ts';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Starts only built production code with a temporary data root and test-owned ephemeral local port.
 */
async function launch(data) {
  const app = await electron.launch({
    cwd: appRoot,
    args: [appRoot, '--executor-test', '--executor-test-data=' + data],
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

test(
  'network opt-in restarts explicitly, exports a separate credential and keeps private bridges local',
  { timeout: 90000 },
  async () => {
    const address = Object.values(networkInterfaces())
      .flat()
      .find(
        (item) =>
          item &&
          !item.internal &&
          item.family === 'IPv4' &&
          networkAddressSchema.safeParse(item.address).success
      )?.address;
    assert.ok(address, 'An assigned private/VPN IPv4 address is required.');
    const root = await mkdtemp(join(tmpdir(), 'octopus-network-electron-'));
    const data = join(root, 'data');
    const workspace = join(root, 'workspace');
    await mkdir(data);
    await mkdir(workspace);
    await writeFile(join(workspace, 'evidence.txt'), 'network fixture');
    let current;
    let client;
    try {
      current = await launch(data);
      const initial = await current.page.evaluate(() => window.executor.readAccess());
      assert.equal(initial.data.remoteEndpoint, null);
      const port = Number(new URL(initial.data.endpoint).port);
      await current.page.getByRole('tab', { name: '连接', exact: true }).click();
      const temporaryGrant = await current.page.evaluate(() =>
        window.executor.approveAccess({
          label: 'not enabled',
          permissions: ['files.read'],
          waitBudgetMs: 120000,
        })
      );
      assert.equal(temporaryGrant.ok, true);
      const refused = await current.page.evaluate(
        (clientId) => window.executor.readClientConfiguration({ clientId, transport: 'remote-http' }),
        temporaryGrant.data.clients[0].clientId
      );
      assert.equal(refused.ok, false);
      await current.page.evaluate(
        (clientId) => window.executor.revokeAccess({ clientId }),
        temporaryGrant.data.clients[0].clientId
      );
      await current.page.getByRole('tab', { name: '设置', exact: true }).click();
      await current.page.getByLabel('MCP 服务端口').fill(String(port));
      await current.page.getByRole('switch', { name: '允许内网 / VPN 客户端连接' }).check();
      await current.page.getByText('请选择本机内网 / VPN IPv4 地址。', { exact: true }).waitFor();
      assert.equal(await current.page.getByRole('button', { name: '保存设置' }).isDisabled(), true);
      await assert.rejects(
        current.page.evaluate(
          (port) => window.executor.saveSettings({ port, networkAddress: '8.8.8.8' }),
          port
        )
      );
      const choices = (await current.page.evaluate(() => window.executor.readNetworkAddresses())).data;
      const choice = choices.find((item) => item.address === address);
      assert.ok(choice);
      await current.page.getByLabel('本机内网 / VPN IPv4 地址').click();
      await current.page
        .getByRole('option', { name: `${choice.interfaceName} · ${address}`, exact: true })
        .click();
      await current.page.locator('#network-address[aria-invalid="false"]').waitFor();
      await current.page.getByRole('button', { name: '保存设置' }).click();
      await current.page.getByText('已保存的设置待重启生效', { exact: true }).waitFor();
      assert.equal(
        (await current.page.evaluate(() => window.executor.readAccess())).data.remoteEndpoint,
        null
      );
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.pendingRestart,
        true
      );
      await current.app.close();
      current = null;
      current = await launch(data);
      const live = (await current.page.evaluate(() => window.executor.readAccess())).data;
      assert.equal(live.endpoint, `http://127.0.0.1:${port}/mcp`);
      assert.equal(live.remoteEndpoint, `http://${address}:${port}/mcp`);
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.pendingRestart,
        false
      );
      await current.page.evaluate(() => window.executor.setBrowserEnabled({ enabled: true }));
      const records = (await readdir(join(data, 'project', 'browser'))).sort();
      const bootstrap = JSON.parse(await readFile(join(data, 'project', 'browser', records.at(-1)), 'utf8'));
      assert.equal(bootstrap.endpoint, `http://127.0.0.1:${port}/browser-bridge`);
      assert.equal(
        (await fetch(live.remoteEndpoint, { headers: { Authorization: 'Bearer ' + bootstrap.credential } }))
          .status,
        401
      );
      assert.equal(
        (
          await fetch(live.remoteEndpoint.replace('/mcp', '/browser-bridge'), {
            headers: { Authorization: 'Bearer ' + bootstrap.credential },
          })
        ).status,
        404
      );
      const output = join(root, 'remote.json');
      await current.app.evaluate(
        ({ dialog }, values) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.workspace] });
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.output });
        },
        { workspace, output }
      );
      await current.page.getByRole('tab', { name: '连接', exact: true }).click();
      await createClientConfiguration(current.page, {
        transport: 'remote-http',
        label: '远端验收智能体',
        permissions: ['files.read'],
        waitBudgetMs: 120000,
      });
      const config = JSON.parse(await readFile(output, 'utf8'));
      const server = Object.values(config.mcpServers)[0];
      assert.equal(server.url, live.remoteEndpoint);
      assert.notEqual(server.headers.Authorization.slice(7), bootstrap.credential);
      assert.equal(
        JSON.stringify(await current.page.evaluate(() => window.executor.readAccess())).includes(
          server.headers.Authorization.slice(7)
        ),
        false
      );
      const localOutput = join(root, 'local-stdio.json');
      await current.app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      }, localOutput);
      const local = await createClientConfiguration(current.page, {
        transport: 'stdio',
        label: 'local stdio',
        permissions: ['files.read'],
        waitBudgetMs: 120000,
      });
      assert.equal(local.ok, true);
      const localDownload = JSON.parse(await readFile(localOutput, 'utf8'));
      const localConfig = JSON.parse(
        await readFile(Object.values(localDownload.mcpServers)[0].args[2], 'utf8')
      );

      assert.equal(localConfig.runtime.url, live.endpoint);
      assert.notEqual(localConfig.runtime.headers.Authorization, server.headers.Authorization);
      client = new Client({ name: 'network-electron-validation', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      );
      await current.page.getByRole('tab', { name: '状态', exact: true }).click();
      await expect
        .poll(async () => {
          const reply = await current.page.evaluate(() => window.executor.readAccess());
          return reply.ok ? reply.data.connections.reduce((total, item) => total + item.sessions, 0) : null;
        })
        .toBe(1);
      await current.page.getByRole('tab', { name: '状态', exact: true, selected: true }).waitFor();
      await current.page.getByRole('button', { name: '服务详情', exact: true }).click();
      assert.equal(await current.page.getByLabel('MCP 连接地址').inputValue(), live.remoteEndpoint);
      await current.page.getByRole('button', { name: '复制连接地址' }).click();
      assert.equal(await current.app.evaluate(({ clipboard }) => clipboard.readText()), live.remoteEndpoint);
      const started = await client.callTool({
        name: 'task_start',
        arguments: { cwd: workspace, capabilities: ['files.read'], idempotencyKey: 'network-production' },
      });
      assert.notEqual(started.isError, true);
      const taskId = started.structuredContent.data.taskId;
      await current.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.close())
      );
      const read = await client.callTool({ name: 'read', arguments: { taskId, path: 'evidence.txt' } });
      assert.equal(read.structuredContent.data.text, 'network fixture');
      await client.callTool({ name: 'task_end', arguments: { taskId } });
      await client.close();
      client = null;
      await current.app.close();
      current = null;
      await assert.rejects(fetch(live.remoteEndpoint));
      await assert.rejects(fetch(live.endpoint));
      current = await launch(data);
      await current.app.evaluate(({ clipboard }) => {
        clipboard.writeText = (value) => {
          globalThis.restartClientConfiguration = value;
        };
      });
      const persistedId = config.clientId;
      assert.equal(
        (
          await current.page.evaluate(
            (clientId) => window.executor.copyClientConfiguration({ clientId, transport: 'remote-http' }),
            persistedId
          )
        ).ok,
        true
      );
      const persisted = JSON.parse(await current.app.evaluate(() => globalThis.restartClientConfiguration));
      assert.deepEqual(Object.values(persisted.mcpServers)[0], server);
      const disabled = await current.page.evaluate(
        (port) => window.executor.saveSettings({ port, networkAddress: null }),
        port
      );
      assert.equal(disabled.ok, true);
      assert.equal(disabled.data.pendingRestart, true);
      await current.app.close();
      current = null;
      current = await launch(data);
      assert.equal(
        (await current.page.evaluate(() => window.executor.readAccess())).data.remoteEndpoint,
        null
      );
      await assert.rejects(fetch(live.remoteEndpoint));
    } finally {
      await client?.close();
      await current?.app.close();
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-network-electron-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
