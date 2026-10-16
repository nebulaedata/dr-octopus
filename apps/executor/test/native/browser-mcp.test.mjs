/**
 * @author Codex
 * @description Verifies Browser grants, task bindings, cursors and unknown outcomes through real SDK/native authority with a deterministic page peer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { BrowserTools } from '../../src/runtime/browser/browser-tools.ts';
import { BasicToolError } from '../../src/runtime/basic/basic-inputs.ts';
import { executorToolCatalog } from '../../src/runtime/mcp/mcp-server.ts';
import { browserParams } from '@octopus/shared/protocol/browser-tools';

test('Browser authorization, source cursor ownership and unknown results never upgrade Basic grants or quarantine browser tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-browser-mcp-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const publication = await FilePublication.open(native, root);
  const basic = new BasicTools(publication);
  const store = await ControlStore.open(native, root);
  const connectionId = randomUUID();
  const controllerId = randomUUID();
  const snapshotId = randomUUID();
  let calls = 0;
  const released = [];
  const peer = {
    /**
     * Records task feedback cleanup separately from public tools.
     */
    release: async (connectionId, taskId) => released.push({ connectionId, taskId }),
    /**
     * Supplies connection evidence without pretending it is a real installed browser.
     */
    snapshot: () => ({
      enabled: true,
      connections: [{ connectionId, state: 'connected', toolsAvailable: true }],
    }),
    /**
     * Returns deterministic source pages and one dispatched outcome failure.
     */
    call: async (_connection, name, params) => {
      calls++;
      if (name === 'browser_click') {
        throw new BasicToolError('OUTCOME_UNKNOWN', 'Injected response loss after dispatch.');
      }
      const text = params.page === 1 ? 'second' : 'first';
      return {
        ...(name === 'browser_snapshot'
          ? { image: { mimeType: 'image/jpeg', data: '/9j/2Q==', width: 1, height: 1 } }
          : {}),
        snapshotId,
        controllerId,
        documentId: 'document',
        page: params.page ?? 0,
        pages: 2,
        totalBytes: 11,
        text,
        digest: createHash('sha256').update('firstsecond').digest('hex'),
        expiresAt: Date.now() + 60000,
        title: 'fixture',
        url: 'http://127.0.0.1/',
      };
    },
  };
  const browser = new BrowserTools(peer);
  const authority = new TaskAuthority(basic, store, undefined, browser);
  const gateway = new HttpGateway(authority);
  const endpoint = await gateway.listen(0);
  const clients = [];
  /**
   * Authenticates actual SDK sessions using credentials issued only by trusted Host approval.
   */
  const connect = async (permissions) => {
    const approved = await authority.approve({
      label: 'fixture',
      permissions,
      waitBudgetMs: 120000,
    });
    const client = new Client({ name: 'browser-authority-fixture', version: '1' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: 'Bearer ' + approved.token } },
      })
    );
    return { client, clientId: approved.grant.clientId };
  };
  /**
   * Preserves protocol error envelopes for negative assertions.
   */
  const call = async (client, name, args = {}) =>
    (await client.callTool({ name, arguments: args })).structuredContent.data;
  try {
    const reader = await connect(['files.read']);
    const owner = await connect(['browser']);
    const other = await connect(['browser']);
    const discovered = (await owner.client.listTools()).tools
      .filter((tool) => tool.name.startsWith('browser_'))
      .map((tool) => tool.name)
      .sort();
    const displayed = executorToolCatalog(true).browser.toSorted();
    assert.deepEqual(discovered, displayed, 'The UI catalog must match authorized MCP discovery');
    assert.equal(displayed.length, 11);
    assert.deepEqual(
      discovered.filter((name) => name !== 'browser_list'),
      Object.keys(browserParams).sort(),
      'Every page tool must have a matching finite extension protocol command'
    );
    assert.equal(displayed.includes('release'), false, 'Feedback cleanup is an internal message');
    assert.equal(
      (await reader.client.listTools()).tools.some((tool) => tool.name.startsWith('browser_')),
      false
    );
    assert.equal(
      (await call(reader.client, 'task_start', { capabilities: ['browser'], idempotencyKey: 'denied' })).error
        .code,
      'FORBIDDEN'
    );
    const task = await call(owner.client, 'task_start', {
      capabilities: ['browser'],
      cwd: join(root, 'directory-that-does-not-exist'),
      idempotencyKey: 'task',
    });
    const rawSnapshot = await owner.client.callTool({
      name: 'browser_snapshot',
      arguments: { taskId: task.taskId, tabId: 1 },
    });
    const snapshot = rawSnapshot.structuredContent.data;
    assert.equal(snapshot.image, undefined, 'Image bytes must not be duplicated in structured metadata');
    assert.deepEqual(
      rawSnapshot.content.find((block) => block.type === 'image'),
      { type: 'image', mimeType: 'image/jpeg', data: '/9j/2Q==' }
    );
    assert.ok(!rawSnapshot.content.find((block) => block.type === 'text').text.includes('/9j/2Q=='));
    assert.equal(snapshot.hasMore, true);
    assert.equal(
      (
        await call(other.client, 'browser_read_snapshot', {
          taskId: task.taskId,
          cursor: snapshot.nextCursor,
        })
      ).error.code,
      'TASK_NOT_FOUND'
    );
    const args = { taskId: task.taskId, cursor: snapshot.nextCursor };
    assert.equal((await call(owner.client, 'browser_read_snapshot', args)).text, 'second');
    assert.equal((await call(owner.client, 'browser_read_snapshot', args)).text, 'second');
    assert.equal(
      (
        await call(owner.client, 'browser_close_tab', {
          taskId: task.taskId,
          tabId: 1,
          idempotencyKey: 'close',
        })
      ).error.code,
      'FORBIDDEN'
    );
    const action = {
      taskId: task.taskId,
      tabId: 1,
      target: { documentId: 'document', controllerId, snapshotId, elementIndex: 0 },
      idempotencyKey: 'unknown',
    };
    assert.equal((await call(owner.client, 'browser_click', action)).error.code, 'OUTCOME_UNKNOWN');
    const before = calls;
    assert.equal((await call(owner.client, 'browser_click', action)).error.code, 'OPERATION_RETAINED');
    assert.equal(calls, before);
    const status = await call(owner.client, 'task_status', { taskId: task.taskId });
    assert.equal(status.task.quarantined, false);
    assert.equal(status.task.browserActionsMayContinue, true);
    await call(owner.client, 'task_end', { taskId: task.taskId });
    assert.deepEqual(released, [{ connectionId, taskId: task.taskId }]);
    const next = await call(other.client, 'task_start', {
      capabilities: ['browser'],
      idempotencyKey: 'next',
    });
    assert.equal(
      (
        await call(other.client, 'browser_read_snapshot', {
          taskId: next.taskId,
          cursor: snapshot.nextCursor,
        })
      ).error.code,
      'SNAPSHOT_EXPIRED'
    );
    await call(other.client, 'task_stop', { taskId: next.taskId });
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await gateway.close();
    await basic.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-browser-mcp-')));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
