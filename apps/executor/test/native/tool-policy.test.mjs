/**
 * @author Codex
 * @description Exercises policy persistence and real MCP discovery/admission across policy changes with isolated native journals.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { executorToolCatalog } from '../../src/runtime/mcp/mcp-server.ts';
import { policyTools, selectedPolicyTools } from '../../src/runtime/mcp/tool-policy.ts';
import { defaultToolPolicySettings, toolPolicySettingsSchema } from '../../src/contracts/tool-policy.ts';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';

test('policy defaults and independent publication survive preference saves and reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-policy-settings-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    const settings = await ConnectionSettings.open(native, root);
    assert.equal(settings.readToolPolicies().selectedId, 'readonly');
    const config = { revision: 1, selectedId: 'all', custom: [] };
    await settings.saveToolPolicies(config);
    await settings.save({ port: 19877, networkAddress: null });
    assert.deepEqual(settings.readToolPolicies(), config);
    const reopened = await ConnectionSettings.open(native, root);
    assert.deepEqual(reopened.readToolPolicies(), config);
    const detached = reopened.readToolPolicies();
    detached.selectedId = 'readonly';
    assert.equal(reopened.readToolPolicies().selectedId, 'all');
    const serialized = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'));
    assert.deepEqual(serialized.toolPolicies, config);
    for (const invalid of [
      { ...config, selectedId: crypto.randomUUID() },
      { ...config, custom: [{ id: crypto.randomUUID(), name: '只读', enabledTools: [] }] },
      { ...config, custom: [{ id: crypto.randomUUID(), name: 'test', enabledTools: ['not_a_tool'] }] },
      { ...config, custom: [{ id: crypto.randomUUID(), name: 'test', enabledTools: ['read', 'read'] }] },
    ]) {
      assert.equal(toolPolicySettingsSchema.safeParse(invalid).success, false);
    }
    assert.deepEqual(
      new Set(policyTools.map((tool) => tool.name)),
      new Set(Object.values(executorToolCatalog(true, true)).flat())
    );
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-policy-settings-')));
    await rm(root, { recursive: true, force: true });
  }
});

test('default readonly rejects cached mutations; changes affect existing sessions without cancelling admitted reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-policy-mcp-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const publication = await FilePublication.open(native, root);
  const basic = new BasicTools(publication);
  const store = await ControlStore.open(native, root);
  const authority = new TaskAuthority(basic, store);
  const gateway = new HttpGateway(authority);
  const clients = [];
  try {
    const endpoint = await gateway.listen(0);
    const approved = await authority.approve({
      label: 'policy test',
      permissions: ['files.read', 'files.write'],
      waitBudgetMs: 120000,
    });
    const client = new Client({ name: 'policy-test', version: '1' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: 'Bearer ' + approved.token } },
      })
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes('read'));
    assert.ok(!names.includes('write'));
    const started = await client.callTool({
      name: 'task_start',
      arguments: { capabilities: ['files.read', 'files.write'], cwd: workspace, idempotencyKey: 'task' },
    });
    const taskId = started.structuredContent.data.taskId;
    const args = {
      taskId,
      path: 'file.txt',
      content: 'hello',
      expectedVersion: 'absent',
      idempotencyKey: 'write',
    };
    const blocked = await client.callTool({ name: 'write', arguments: args });
    assert.equal(blocked.structuredContent.data.error.code, 'TOOL_DISABLED');
    assert.equal(store.tasks.get(taskId).operations.length, 0);
    authority.setToolPolicy(
      policyTools.map((tool) => tool.name),
      1
    );
    gateway.notifyToolListChanged();
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'write'));
    assert.equal((await client.callTool({ name: 'write', arguments: args })).isError, undefined);
    assert.equal(await readFile(join(workspace, 'file.txt'), 'utf8'), 'hello');

    let enter;
    let finish;
    const entered = new Promise((resolve) => {
      enter = resolve;
    });
    const release = new Promise((resolve) => {
      finish = resolve;
    });
    const originalRead = basic.read.bind(basic);
    basic.read = async (...input) => {
      enter();
      await release;
      return originalRead(...input);
    };
    const reading = client.callTool({ name: 'read', arguments: { taskId, path: 'file.txt' } });
    await entered;
    authority.setToolPolicy([], 2);
    finish();
    assert.equal((await reading).structuredContent.data.text, 'hello');
    assert.deepEqual((await client.listTools()).tools, []);
    const disabled = await client.callTool({ name: 'read', arguments: { taskId, path: 'file.txt' } });
    assert.equal(disabled.structuredContent.data.error.code, 'TOOL_DISABLED');
    for (const [name, arguments_] of [
      ['task_status', { taskId }],
      ['task_end', { taskId }],
      ['task_stop', { taskId }],
      ['browser_list', {}],
      ['file_transfer_status', { transferId: crypto.randomUUID(), taskId }],
    ]) {
      const reply = await client.callTool({ name, arguments: arguments_ });
      assert.equal(reply.isError, true);
    }
    assert.throws(() => authority.setToolPolicy([], 1), /stale/);
    authority.setToolPolicy(selectedPolicyTools(defaultToolPolicySettings), 3);
    assert.equal((await client.callTool({ name: 'task_end', arguments: { taskId } })).isError, undefined);
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await gateway.close();
    await basic.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-policy-mcp-')));
    await rm(root, { recursive: true, force: true });
  }
});
