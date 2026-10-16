/**
 * @author Codex
 * @description Verifies the installed Server MCP adapter distinguishes same-name executors and preserves model-visible target metadata.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { DeviceIdentityStore } from '../../src/main/device-identity.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { deviceConnectionKey } from '../../src/contracts/device-identity.ts';

const serverRequire = createRequire(new URL('../../../server/package.json', import.meta.url));
const adapterRoot = dirname(serverRequire.resolve('pi-mcp-adapter'));
const { formatToolName } = await import(pathToFileURL(serverRequire.resolve('pi-mcp-adapter/types')).href);
const { McpServerManager } = await import(pathToFileURL(join(adapterRoot, 'server-manager.ts')).href);
const { buildToolMetadata } = await import(pathToFileURL(join(adapterRoot, 'tool-metadata.ts')).href);

test('installed adapter discovers and calls two independent same-name executors without prefix collisions', async () => {
  const manager = new McpServerManager();
  const instances = [];
  try {
    for (let index = 0; index < 2; index++) {
      const root = await mkdtemp(join(tmpdir(), 'octopus-device-adapter-'));
      const instance = { root };
      instances.push(instance);
      const native = new NativeFileCommit(
        fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
      );
      const identity = await DeviceIdentityStore.open(native, root, false);
      await identity.rename('同名办公电脑');
      instance.device = identity.read();
      instance.store = await ControlStore.open(native, root);
      // This test exercises discovery/status only, so no execution backend is admitted or invoked.
      instance.authority = new TaskAuthority({}, instance.store, undefined, undefined, instance.device);
      instance.gateway = new HttpGateway(instance.authority);
      const endpoint = await instance.gateway.listen(0);
      const grant = await instance.authority.approve({
        label: 'isolated discovery',
        permissions: ['files.read'],
        waitBudgetMs: 120000,
      });
      instance.key = deviceConnectionKey(instance.device);
      const definition = { url: endpoint, headers: { Authorization: 'Bearer ' + grant.token } };
      const connection = await manager.connect(instance.key, definition);
      for (const prefix of ['server', 'short', 'mcp', 'none']) {
        assert.match(formatToolName('browser_read_snapshot', instance.key, prefix), /^[A-Za-z0-9_-]{1,64}$/);
        const result = buildToolMetadata(connection.tools, [], definition, instance.key, prefix);
        assert.deepEqual(result.failedTools, []);
        const status = result.metadata.find((tool) => tool.originalName === 'runtime_status');
        assert.ok(status.description.includes(instance.device.deviceName));
        assert.ok(status.description.includes(instance.device.deviceId));
        for (const tool of result.metadata) {
          assert.match(tool.name, /^[A-Za-z0-9_-]{1,64}$/);
          assert.ok(tool.description.includes(instance.device.deviceName));
          assert.ok(tool.description.includes(instance.device.deviceId));
        }
      }
      const result = await connection.client.callTool({ name: 'runtime_status', arguments: {} });
      assert.deepEqual(JSON.parse(result.content[0].text).device, instance.device);
    }
    assert.notEqual(instances[0].key, instances[1].key);
    assert.notEqual(instances[0].device.deviceId, instances[1].device.deviceId);
  } finally {
    await manager.closeAll();
    for (const instance of instances) {
      await instance.gateway?.close();
      await instance.authority?.close();
      await instance.store?.close();
      await rm(instance.root, { recursive: true, force: true });
    }
  }
});
