/**
 * @author Codex
 * @description Exercises Computer authorization, shared task admission and retained results through the real HTTP MCP and native control journal without desktop input.
 */
import assert from 'node:assert/strict';
import { policyToolNameSchema } from '../../src/contracts/tool-policy.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { computerFixture } from '../fixtures/computer-backend.mjs';

/**
 * Owns isolated native journals and actual loopback SDK sessions; no user files or desktop actions are accessed.
 */
async function fixture(run) {
  await computerFixture(async ({ tools: computer, state, activity }) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-computer-mcp-'));
    const workspace = join(root, 'workspace');
    await mkdir(workspace);
    await writeFile(join(workspace, 'fixture.txt'), 'fixture');
    const native = new NativeFileCommit(
      fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
    );
    const publication = await FilePublication.open(native, root);
    const basic = new BasicTools(publication);
    const store = await ControlStore.open(native, root);
    const authority = new TaskAuthority(basic, store, computer);
    authority.setToolPolicy(policyToolNameSchema.options, 0);
    const gateway = new HttpGateway(authority);
    const endpoint = await gateway.listen(0);
    const clients = [];
    /**
     * Grants through trusted Host admission and authenticates an actual SDK HTTP client.
     */
    const connect = async (permissions, waitBudgetMs = 120000, beforeConnect = () => {}) => {
      const approved = await authority.approve({
        label: 'fixture',
        permissions,
        waitBudgetMs,
      });
      const client = new Client({ name: 'fixture-computer-client', version: '1' });
      clients.push(client);
      beforeConnect();
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: { Authorization: 'Bearer ' + approved.token } },
        })
      );
      return { client, clientId: approved.grant.clientId };
    };
    try {
      await run({ workspace, authority, computer, state, activity, connect });
    } finally {
      await Promise.allSettled(clients.map((client) => client.close()));
      await gateway.close();
      await basic.close();
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-computer-mcp-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}

/**
 * Obtains the validated product payload from a successful MCP call.
 */
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent.data;
}

test('unified desktop grant exposes dot-named tools and returns MCP images without base64 metadata', async () => {
  await fixture(async ({ connect, authority, state }) => {
    const { client, clientId } = await connect(['computer.control']);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((t) => t.name === 'computer.screenshot'));
    assert.ok(!listed.tools.some((t) => t.name === 'computer_observe'));
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'task',
    });
    const result = await client.callTool({
      name: 'computer.screenshot',
      arguments: { taskId: task.taskId, idempotencyKey: 'shot' },
    });
    assert.notEqual(result.isError, true);
    assert.equal(result.content.filter((c) => c.type === 'image').length, 1);
    assert.equal(JSON.stringify(result.structuredContent).includes('base64'), false);
    await call(client, 'task_end', { taskId: task.taskId });
    assert.equal(state.stopped, 1);
    assert.equal(authority.status(clientId).task, null);
  });
});
test('unknown desktop action is retained and explicit stop releases only its own barrier', async () => {
  await fixture(async ({ connect, authority, state }) => {
    const { client, clientId } = await connect(['computer.control', 'files.read']);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'unknown-task',
    });
    state.result = {
      isError: true,
      content: [{ type: 'text', text: 'failure after dispatch' }],
    };
    const args = { taskId: task.taskId, idempotencyKey: 'mutation', point: [10, 20], text: 'fixture' };
    const result = await client.callTool({ name: 'computer.type', arguments: args });
    assert.equal(result.isError, true);
    assert.equal(authority.status(clientId).task.quarantined, true);
    await client.callTool({ name: 'computer.type', arguments: args });
    assert.equal(state.calls.filter((c) => c.name === 'Type').length, 1);
    await call(client, 'task_stop', { taskId: task.taskId });
    assert.equal(authority.status(clientId).task, null);
    const next = await call(client, 'task_start', {
      capabilities: ['files.read'],
      idempotencyKey: 'after-stop',
    });
    await call(client, 'task_end', { taskId: next.taskId });
  });
});

test('short client budget cannot dispatch Snapshot through external MCP', async () => {
  await fixture(async ({ connect, state }) => {
    const { client } = await connect(['computer.control'], 30000);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'short-client',
    });
    const result = await client.callTool({
      name: 'computer.snapshot',
      arguments: { taskId: task.taskId, idempotencyKey: 'short-snapshot' },
    });
    assert.equal(result.structuredContent.data.error.code, 'COMPUTER_BUDGET_INSUFFICIENT');
    assert.deepEqual(state.calls, []);
    await call(client, 'task_end', { taskId: task.taskId });
  });
});

test('interrupted observation preserves control isolation without claiming unknown input', async () => {
  await fixture(async ({ connect, state, authority }) => {
    const { client, clientId } = await connect(['computer.control', 'files.read']);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'observe-failure',
    });
    state.result = { content: [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }] };
    const response = await client.callTool({
      name: 'computer.screenshot',
      arguments: { taskId: task.taskId, idempotencyKey: 'bad-image' },
    });
    assert.equal(response.structuredContent.data.error.code, 'COMPUTER_OBSERVATION_INTERRUPTED');
    const status = await call(client, 'task_status', { taskId: task.taskId, operationKey: 'bad-image' });
    assert.equal(status.operation.state, 'unknown');
    assert.equal(status.operation.effect, 'not_applied');
    assert.equal(authority.status(clientId).task.quarantined, true);
    await call(client, 'task_stop', { taskId: task.taskId });
    assert.equal(authority.status(clientId).task, null);
  });
});

test('a session created while desktop is offline discovers and calls tools after explicit recovery', async (t) => {
  await fixture(async ({ connect, computer, state }) => {
    let online = true;
    const available = computer.available.bind(computer);
    t.mock.method(computer, 'available', () => online && available());
    t.mock.method(computer, 'restart', async () => {
      online = true;
    });
    const { client } = await connect(['computer.control'], 120000, () => {
      online = false;
    });
    assert.deepEqual(
      (await client.listTools()).tools.filter((tool) => tool.name.startsWith('computer.')),
      []
    );
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'recover',
    });
    const discovered = (await client.listTools()).tools;
    assert.equal(
      discovered.find((tool) => tool.name === 'computer.control.status').annotations.readOnlyHint,
      true
    );
    assert.equal(
      discovered.find((tool) => tool.name === 'computer.snapshot').annotations.readOnlyHint,
      false
    );
    const names = discovered.map((tool) => tool.name);
    assert.ok(names.includes('computer.snapshot'));
    assert.ok(names.includes('computer.screenshot'));
    const status = await call(client, 'computer.control.status', { taskId: task.taskId });
    assert.equal(status.control.state, 'ready');
    await call(client, 'task_end', { taskId: task.taskId });
    assert.deepEqual(
      (await client.listTools()).tools.filter((tool) => tool.name.startsWith('computer.')),
      []
    );
    assert.equal(state.calls.filter((tool) => tool.name === 'ControlStatus').length, 1);
  });
});
test('stable desktop registration cannot bypass grant checks or revocation', async () => {
  await fixture(async ({ connect, authority, state }) => {
    const reader = await connect(['files.read']);
    assert.deepEqual(
      (await reader.client.listTools()).tools.filter((tool) => tool.name.startsWith('computer.')),
      []
    );
    const task = await call(reader.client, 'task_start', {
      capabilities: ['files.read'],
      idempotencyKey: 'read-only',
    });
    const response = await reader.client.callTool({
      name: 'computer.screenshot',
      arguments: { taskId: task.taskId, idempotencyKey: 'forbidden' },
    });
    assert.equal(response.isError, true);
    assert.deepEqual(state.calls, []);
    await call(reader.client, 'task_end', { taskId: task.taskId });
    const controller = await connect(['computer.control']);
    await authority.revoke(controller.clientId);
    await assert.rejects(controller.client.listTools());
    assert.deepEqual(state.calls, []);
  });
});
