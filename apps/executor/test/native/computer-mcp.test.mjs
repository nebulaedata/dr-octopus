/**
 * @author Codex
 * @description Exercises Computer authorization, shared task admission and retained results through the real HTTP MCP and native control journal without desktop input.
 */
import assert from 'node:assert/strict';
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
    const gateway = new HttpGateway(authority);
    const endpoint = await gateway.listen(0);
    const clients = [];
    /**
     * Grants through trusted Host admission and authenticates an actual SDK HTTP client.
     */
    const connect = async (permissions) => {
      const approved = await authority.approve({
        label: 'fixture',
        permissions,
        waitBudgetMs: 120000,
      });
      const client = new Client({ name: 'fixture-computer-client', version: '1' });
      clients.push(client);
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

test('MCP capture refusals expose a finite cause without an image, old observation or automatic retry', async () => {
  await fixture(async ({ connect, state, activity }) => {
    const { client } = await connect(['computer.control']);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'capture-refusal-task',
    });
    state.responses.ExecutorCapture = {
      isError: true,
      content: [{ type: 'text', text: 'private backend details must not escape' }],
      structuredContent: { contractVersion: 1, error: { code: 'TARGET_CHANGED' } },
    };
    const result = await client.callTool({ name: 'computer_observe', arguments: { taskId: task.taskId } });
    assert.equal(result.structuredContent.data.error.code, 'TARGET_CHANGED');
    assert.equal(
      result.content.some(({ type }) => type === 'image'),
      false
    );
    assert.equal(JSON.stringify(result).includes('private backend details'), false);
    assert.equal(state.calls.filter(({ name }) => name === 'ExecutorCapture').length, 1);
    assert.equal(
      state.calls.some(({ name }) => name === 'ExecutorInput'),
      false
    );
    assert.equal(activity.snapshot().state, 'running', 'Capture refusal must retain task-lifetime feedback');
    await call(client, 'task_end', { taskId: task.taskId });
    assert.equal(activity.snapshot().state, 'idle');
  });
});

test('old Basic grants never gain desktop permissions; observe grants cannot call input; task capabilities are rechecked', async () => {
  await fixture(async ({ connect, state, activity }) => {
    const { client: basic } = await connect(['files.read']);
    assert.equal(activity.snapshot().state, 'idle');
    assert.equal(
      (await basic.listTools()).tools.some((tool) => tool.name.startsWith('computer_')),
      false
    );
    const { client: observer } = await connect(['computer.observe']);
    assert.deepEqual(
      (await observer.listTools()).tools
        .filter((tool) => tool.name.startsWith('computer_'))
        .map((tool) => tool.name)
        .sort(),
      ['computer_displays', 'computer_observe', 'computer_windows']
    );
    const { client: controller } = await connect(['computer.control']);
    assert.equal(
      (await controller.listTools()).tools.filter((tool) => tool.name.startsWith('computer_')).length,
      8
    );
    const task = await call(controller, 'task_start', {
      capabilities: ['computer.observe'],
      idempotencyKey: 'observe-task',
    });
    assert.equal(activity.snapshot().state, 'running');
    const { windows } = await call(controller, 'computer_windows', { taskId: task.taskId });
    const result = await controller.callTool({
      name: 'computer_focus',
      arguments: { taskId: task.taskId, windowId: windows[0].windowId, idempotencyKey: 'forbidden' },
    });
    assert.equal(result.structuredContent.data.error.code, 'FORBIDDEN');
    assert.equal(
      state.calls.some((entry) => entry.name === 'ExecutorFocusWindow'),
      false
    );
    await call(controller, 'task_end', { taskId: task.taskId });
    assert.equal(activity.snapshot().state, 'idle');
  });
});

test('capture uses one MCP image block, mutations retain keys without replay, and Basic calls invalidate desktop observations', async () => {
  await fixture(async ({ workspace, connect, state, activity }) => {
    const { client } = await connect(['computer.control', 'files.read']);
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['computer.control', 'files.read'],
      idempotencyKey: 'mixed-task',
    });
    const imageResult = await client.callTool({
      name: 'computer_observe',
      arguments: { taskId: task.taskId },
    });
    assert.equal(imageResult.content.filter((item) => item.type === 'image').length, 1);
    const observation = imageResult.structuredContent.data;
    assert.equal(activity.snapshot().state, 'running');
    assert.equal('image' in observation, false);
    assert.equal(JSON.stringify(observation).includes('123456'), false);
    const args = {
      taskId: task.taskId,
      windowId: observation.windowId,
      observationId: observation.observationId,
      text: '中文😀',
      idempotencyKey: 'type-once',
    };
    assert.equal((await call(client, 'computer_type', args)).businessEffect, 'applied');
    assert.equal((await call(client, 'computer_type', args)).retained, true);
    assert.equal(state.calls.filter((entry) => entry.name === 'ExecutorInput').length, 1);
    assert.equal(activity.snapshot().activeCalls, 0);
    assert.equal(activity.snapshot().state, 'running');
    const next = await call(client, 'computer_observe', { taskId: task.taskId });
    await call(client, 'read', { taskId: task.taskId, path: 'fixture.txt' });
    const result = await client.callTool({
      name: 'computer_type',
      arguments: {
        ...args,
        windowId: next.windowId,
        observationId: next.observationId,
        idempotencyKey: 'after-basic-valid',
      },
    });
    assert.equal(result.structuredContent.data.error.code, 'OBSERVATION_STALE');
    await call(client, 'task_end', { taskId: task.taskId });
    assert.equal(activity.snapshot().state, 'idle');
  });
});

test('one authority serializes Basic and Computer; stopping closes admission and waits for the already dispatched fixture action', async () => {
  await fixture(async ({ connect, authority, state, activity }) => {
    const { client, clientId } = await connect(['computer.control', 'files.read']);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control', 'files.read'],
      idempotencyKey: 'concurrent',
    });
    const observation = await call(client, 'computer_observe', { taskId: task.taskId });
    let complete;
    state.hold = new Promise((resolve) => {
      complete = resolve;
    });
    const pending = authority.call(
      clientId,
      'computer_type',
      {
        taskId: task.taskId,
        windowId: observation.windowId,
        observationId: observation.observationId,
        text: 'fixture',
        idempotencyKey: 'running',
      },
      new AbortController().signal
    );
    while (!state.calls.some((entry) => entry.name === 'ExecutorInput')) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      authority.call(
        clientId,
        'read',
        { taskId: task.taskId, path: 'fixture.txt' },
        new AbortController().signal
      ),
      (error) => error.code === 'ACTION_IN_PROGRESS'
    );
    let stopped = false;
    const stop = authority.stop(clientId, task.taskId).then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopped, false);
    assert.equal(activity.snapshot().state, 'running');
    complete();
    await pending;
    await stop;
    assert.equal(activity.snapshot().state, 'idle');
    const summary = authority.taskStatus(clientId, { taskId: task.taskId, operationKey: 'running' });
    assert.equal(summary.task.state, 'cancelled');
    assert.equal(summary.operation.state, 'completed');
    assert.equal(state.calls.filter((entry) => entry.name === 'ExecutorInput').length, 1);
  });
});

test('revocation and expiry release continuous task feedback only after the task has drained', async (context) => {
  await fixture(async ({ connect, authority, state, activity }) => {
    const { client, clientId } = await connect(['computer.control']);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'revoke-task',
    });
    const observation = await call(client, 'computer_observe', { taskId: task.taskId });
    let complete;
    state.hold = new Promise((resolve) => {
      complete = resolve;
    });
    const pending = authority.call(
      clientId,
      'computer_type',
      {
        taskId: task.taskId,
        windowId: observation.windowId,
        observationId: observation.observationId,
        text: 'fixture',
        idempotencyKey: 'revoke-input',
      },
      new AbortController().signal
    );
    const settled = assert.rejects(pending, (error) => error.code === 'UNAUTHORIZED');
    while (!state.calls.some((entry) => entry.name === 'ExecutorInput')) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const revoke = authority.revoke(clientId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(activity.snapshot().state, 'running');
    complete();
    await settled;
    await revoke;
    assert.equal(activity.snapshot().state, 'idle');
    const { client: next, clientId: nextId } = await connect(['computer.observe']);
    const expired = await call(next, 'task_start', {
      capabilities: ['computer.observe'],
      idempotencyKey: 'expiry-task',
    });
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      context.mock.timers.tick(1800001);
      await authority.expire();
    } finally {
      context.mock.timers.reset();
    }
    assert.equal(authority.taskStatus(nextId, { taskId: expired.taskId }).task.state, 'cancelled');
    assert.equal(activity.snapshot().state, 'idle');
  });
});

test('unknown actions retain durable evidence, suppress tools and prevent replay or admission release', async () => {
  await fixture(async ({ connect, authority, state, activity }) => {
    const { client, clientId } = await connect(['computer.control']);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'unknown-task',
    });
    const observation = await call(client, 'computer_observe', { taskId: task.taskId });
    state.result = { contractVersion: 1, effect: 'unknown', code: 'PARTIAL_INPUT' };
    const args = {
      taskId: task.taskId,
      observationId: observation.observationId,
      windowId: observation.windowId,
      text: 'fixture',
      idempotencyKey: 'unknown-action',
    };
    assert.equal((await call(client, 'computer_type', args)).businessEffect, 'unknown');
    const replay = await client.callTool({ name: 'computer_type', arguments: args });
    assert.equal(replay.structuredContent.data.error.code, 'OPERATION_RETAINED');
    const summary = authority.taskStatus(clientId, { taskId: task.taskId, operationKey: 'unknown-action' });
    assert.equal(summary.operation.state, 'unknown');
    assert.equal(summary.task.quarantined, true);
    assert.equal(
      (await client.listTools()).tools.some((tool) => tool.name.startsWith('computer_')),
      false
    );
    await call(client, 'task_stop', { taskId: task.taskId });
    assert.equal(activity.snapshot().state, 'unknown');
    assert.equal(state.calls.filter((entry) => entry.name === 'ExecutorInput').length, 1);
    await assert.rejects(
      authority.start(clientId, { capabilities: ['computer.observe'], idempotencyKey: 'new-task' }),
      (error) => error.code === 'COMPUTER_UNAVAILABLE'
    );
  });
});

test('trusted desktop stop cancels the task and clears the ribbon only after owned cleanup while retaining unknown effects', async () => {
  await fixture(async ({ connect, authority, computer, state, activity }) => {
    const { client, clientId } = await connect(['computer.control']);
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'local-escape-task',
    });
    const observation = await call(client, 'computer_observe', { taskId: task.taskId });
    state.result = { contractVersion: 1, effect: 'unknown', code: 'PARTIAL_INPUT' };
    await call(client, 'computer_key', {
      taskId: task.taskId,
      observationId: observation.observationId,
      windowId: observation.windowId,
      key: 'Escape',
      idempotencyKey: 'unknown-before-local-stop',
    });
    assert.equal(activity.snapshot().state, 'unknown');
    await authority.stopComputerUse();
    assert.equal(activity.snapshot().state, 'unknown', 'task cancellation alone cannot claim backend exit');
    await computer.close();
    const result = authority.taskStatus(clientId, {
      taskId: task.taskId,
      operationKey: 'unknown-before-local-stop',
    });
    assert.equal(result.task.state, 'cancelled');
    assert.equal(result.task.quarantined, true);
    assert.equal(result.operation.state, 'unknown');
    assert.equal(activity.snapshot().state, 'idle');
    assert.equal(activity.snapshot().activityId, null);
    assert.equal(state.stopped, 1);
    assert.equal(state.calls.filter(({ name }) => name === 'ExecutorInput').length, 1);
    await assert.rejects(
      authority.start(clientId, { capabilities: ['computer.observe'], idempotencyKey: 'after-local-stop' }),
      (error) => error.code === 'COMPUTER_UNAVAILABLE'
    );
  });
});

test('trusted desktop stop does not cancel a Basic-only task', async () => {
  await fixture(async ({ connect, authority, workspace, activity }) => {
    const { client, clientId } = await connect(['files.read']);
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['files.read'],
      idempotencyKey: 'basic-not-computer',
    });
    await authority.stopComputerUse();
    assert.equal(authority.taskStatus(clientId, { taskId: task.taskId }).task.state, 'active');
    assert.equal(activity.snapshot().state, 'idle');
    await call(client, 'read', { taskId: task.taskId, path: 'fixture.txt' });
    await call(client, 'task_end', { taskId: task.taskId });
  });
});
