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

test('policy defaults and unified publication survive preference saves and reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-policy-settings-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    const settings = await ConnectionSettings.open(native, root);
    assert.equal(settings.readToolPolicies().selectedId, 'readonly');
    const config = { revision: 1, selectedId: 'all', custom: [] };
    await settings.save({ port: 19876, networkAddress: null, toolPolicies: config });
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

test('saved policy changes affect MCP discovery and admission only after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-policy-mcp-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const settings = await ConnectionSettings.open(native, root);
  let basic;
  let gateway;
  let client;
  let authority;
  let store;
  /**
   * Recreates the Runtime owners using the persisted startup policy and a fresh MCP session.
   */
  async function start() {
    basic = new BasicTools(await FilePublication.open(native, root));
    store = await ControlStore.open(native, root);
    const policy = settings.readToolPolicies();
    authority = new TaskAuthority(basic, store, undefined, undefined, undefined, {
      revision: policy.revision,
      enabledTools: selectedPolicyTools(policy),
    });
    gateway = new HttpGateway(authority);
    const endpoint = await gateway.listen(0);
    const approved = await authority.approve({
      label: 'policy test',
      permissions: ['files.read', 'files.write'],
      waitBudgetMs: 120000,
    });
    client = new Client({ name: 'policy-test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: 'Bearer ' + approved.token } },
      })
    );
  }
  /**
   * Closes only this fixture's session and Runtime resources before another startup.
   */
  async function stop() {
    await client?.close();
    await gateway?.close();
    await basic?.close();
  }
  try {
    await start();
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'write'));
    await settings.save({
      port: 19876,
      networkAddress: null,
      toolPolicies: { revision: 1, selectedId: 'all', custom: [] },
    });
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'write'));
    const started = await client.callTool({
      name: 'task_start',
      arguments: {
        capabilities: ['files.read', 'files.write'],
        cwd: workspace,
        idempotencyKey: 'before-restart',
      },
    });
    const args = {
      taskId: started.structuredContent.data.taskId,
      path: 'file.txt',
      content: 'hello',
      expectedVersion: 'absent',
      idempotencyKey: 'write',
    };
    const blocked = await client.callTool({ name: 'write', arguments: args });
    assert.equal(blocked.structuredContent.data.error.code, 'TOOL_DISABLED');
    assert.equal(store.tasks.get(args.taskId).operations.length, 0);
    await client.callTool({ name: 'task_end', arguments: { taskId: args.taskId } });
    await stop();
    await start();
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'write'));
    const next = await client.callTool({
      name: 'task_start',
      arguments: {
        capabilities: ['files.read', 'files.write'],
        cwd: workspace,
        idempotencyKey: 'after-restart',
      },
    });
    args.taskId = next.structuredContent.data.taskId;
    // Tightening permissions also waits for restart; current calls keep the loaded policy.
    await settings.save({
      port: 19876,
      networkAddress: null,
      toolPolicies: { ...defaultToolPolicySettings, revision: 2 },
    });
    assert.equal((await client.callTool({ name: 'write', arguments: args })).isError, undefined);
    assert.equal(await readFile(join(workspace, 'file.txt'), 'utf8'), 'hello');
    await client.callTool({ name: 'task_end', arguments: { taskId: args.taskId } });
    await stop();
    await start();
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'write'));
    assert.throws(() => authority.requireToolEnabled('write'), /disabled/);
  } finally {
    await stop();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-policy-mcp-')));
    await rm(root, { recursive: true, force: true });
  }
});
