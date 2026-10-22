/**
 * @author Codex
 * @description Exercises authenticated generic MCP against real native file tools and durable control history.
 */
import assert from 'node:assert/strict';
import { policyToolNameSchema } from '../../src/contracts/tool-policy.ts';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { request, createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { testNodeResources } from '../fixtures/node-resources.mjs';
import { ShellExecutor } from '../../src/runtime/basic/shell-executor.ts';
import { SearchTools } from '../../src/runtime/basic/search-tools.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { networkAddressSchema } from '../../src/contracts/connection-settings.ts';

const binary = fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url));

test('HTTP discovers PowerShell with its actual identity and rejects the removed Bash tool', async () => {
  await fixture(async ({ authority, endpoint, clients, workspace }) => {
    const approval = await authority.approve({
      label: 'system Shell',
      permissions: ['shell.execute'],
      waitBudgetMs: 120000,
    });
    const { client } = await connect(endpoint, approval.token, clients);
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some((tool) => tool.name === 'powershell'));
    assert.ok(!tools.some((tool) => tool.name === 'bash'));
    assert.match(tools.find((tool) => tool.name === 'powershell').description, /PowerShell 5\.1/);
    const status = await call(client, 'runtime_status', {});
    assert.equal(status.shell.kind, 'powershell');
    assert.equal(status.shell.available, true);
    assert.match(status.shell.version, /^5\.1\./);
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['shell.execute'],
      idempotencyKey: 'shell',
    });
    const old = await client.callTool({
      name: 'bash',
      arguments: { taskId: task.taskId, command: 'echo old', idempotencyKey: 'old' },
    });
    assert.equal(old.isError, true);
    const result = await call(client, 'powershell', {
      taskId: task.taskId,
      command: "[Console]::Write('系统 PowerShell')",
      idempotencyKey: 'new',
    });
    assert.equal(result.output, '系统 PowerShell');
    await call(client, 'task_end', { taskId: task.taskId });
  }, true);
});

test('HTTP keeps independent file tools available when the Shell backend is unavailable', async () => {
  await fixture(async ({ authority, endpoint, clients, workspace }) => {
    const approval = await authority.approve({
      label: 'without Shell',
      permissions: ['files.write', 'shell.execute'],
      waitBudgetMs: 120000,
    });
    const { client } = await connect(endpoint, approval.token, clients);
    const tools = (await client.listTools()).tools;
    assert.ok(!tools.some((tool) => tool.name === 'powershell' || tool.name === 'bash'));
    assert.ok(tools.some((tool) => tool.name === 'read'));
    assert.equal((await call(client, 'runtime_status', {})).shell.available, false);
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['files.write'],
      idempotencyKey: 'files',
    });
    await call(client, 'write', {
      taskId: task.taskId,
      path: 'still-available.txt',
      content: 'ok',
      expectedVersion: 'absent',
      idempotencyKey: 'write',
    });
    assert.equal(
      (await call(client, 'read', { taskId: task.taskId, path: 'still-available.txt' })).text,
      'ok'
    );
    await call(client, 'task_end', { taskId: task.taskId });
  });
});

/**
 * Owns a private temporary NTFS fixture and drains network and tool owners before cleanup.
 */
async function fixture(run, withShell = false, networkAddress = null) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-mcp-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const native = new NativeFileCommit(binary);
  const publication = await FilePublication.open(native, root);
  const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
  const shell = withShell
    ? await ShellExecutor.open(
        join(dist, 'native', 'process-supervisor.exe'),
        root,
        native,
        await testNodeResources(dist, native)
      )
    : undefined;
  const search = new SearchTools(
    join(dist, 'native', 'process-supervisor.exe'),
    join(dist, 'resources', 'search'),
    root,
    native
  );
  await search.verify();
  const tools = new BasicTools(publication, shell, search);
  const store = await ControlStore.open(native, root);
  const authority = new TaskAuthority(tools, store, undefined, undefined, {
    deviceId: '89b7dada-bb9d-4b25-a1ef-ff6a3e8b189a',
    deviceName: '办公电脑',
  });
  authority.setToolPolicy(policyToolNameSchema.options, 0);
  const gateway = new HttpGateway(authority);
  const endpoint = await gateway.listen(0, networkAddress);
  const clients = [];
  try {
    await run({ root, workspace, native, tools, store, authority, gateway, endpoint, clients });
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await gateway.close();
    await tools.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-mcp-')));
    await rm(root, { recursive: true, force: true });
  }
}

test(
  'authenticated long tool replies stream keep-alive before completion and preserve their result correlation',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ workspace, authority, endpoint, clients }) => {
      const approved = await authority.approve({
        label: 'long reply validation',
        permissions: ['shell.execute'],
        waitBudgetMs: 120000,
      });
      const headers = { Authorization: 'Bearer ' + approved.token };
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers } });
      const client = new Client({ name: 'long-reply-test', version: '1' });
      clients.push(client);
      await client.connect(transport);
      const started = await client.callTool({
        name: 'task_start',
        arguments: { cwd: workspace, capabilities: ['shell.execute'], idempotencyKey: 'long-reply-task' },
      });
      const taskId = started.structuredContent.data.taskId;
      const began = Date.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...headers,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Mcp-Session-Id': transport.sessionId,
          'Mcp-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 97,
          method: 'tools/call',
          params: {
            name: 'powershell',
            arguments: {
              taskId,
              command: "Start-Sleep -Seconds 25; [Console]::Write('keepalive-proof')",
              timeout: 30,
              idempotencyKey: 'long-reply-powershell',
            },
          },
        }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/event-stream/);
      const reader = response.body.getReader();
      const first = await reader.read();
      assert.equal(first.done, false);
      assert.ok(
        Date.now() - began < 23000,
        'The actual stream must respond before the 25-second tool result'
      );
      assert.match(
        new TextDecoder().decode(first.value),
        /^:/,
        'SDK keep-alive comments carry no fake result'
      );
      const chunks = [first.value];
      for (;;) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        chunks.push(next.value);
      }
      const message = Buffer.concat(chunks)
        .toString()
        .split('\n')
        .find((line) => line.startsWith('data: '));
      const reply = JSON.parse(message.slice(6));
      assert.equal(reply.id, 97);
      assert.equal(reply.result.structuredContent.data.output, 'keepalive-proof');
      assert.equal(reply.result.structuredContent.data.executionState, 'quiescent');
      await client.callTool({ name: 'task_end', arguments: { taskId } });
    }, true);
  }
);

test('explicit private-network MCP shares authority, isolates sessions and rejects bridge, origins and revoked credentials', async () => {
  const address = Object.values(networkInterfaces())
    .flat()
    .find(
      (item) =>
        item &&
        !item.internal &&
        item.family === 'IPv4' &&
        networkAddressSchema.safeParse(item.address).success
    )?.address;
  assert.ok(address, 'This integration requires an assigned private/VPN IPv4 address.');
  await fixture(
    async ({ workspace, authority, gateway, endpoint, clients }) => {
      const remote = gateway.remoteEndpoint();
      assert.ok(remote.startsWith(`http://${address}:`));
      const approved = await authority.approve({
        label: 'remote validation',
        permissions: ['files.write'],
        waitBudgetMs: 120000,
      });
      const other = await authority.approve({
        label: 'other remote',
        permissions: ['files.read'],
        waitBudgetMs: 120000,
      });
      const auth = { Authorization: `Bearer ${approved.token}` };
      assert.equal((await fetch(remote)).status, 401);
      assert.equal(
        (await fetch(remote, { headers: { Authorization: 'Bearer ' + 'b'.repeat(64) } })).status,
        401
      );
      assert.equal(
        (await fetch(remote, { headers: { ...auth, Origin: 'http://untrusted.test' } })).status,
        403
      );
      const wrongHost = await new Promise((resolve, reject) => {
        const req = request(remote, { headers: { ...auth, Host: new URL(endpoint).host } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(wrongHost, 403);
      assert.equal(
        (
          await fetch(remote.replace('/mcp', '/browser-bridge'), {
            method: 'POST',
            headers: auth,
            body: '{}',
          })
        ).status,
        404
      );
      assert.equal((await fetch(remote + '?token=ignored', { headers: auth })).status, 404);
      const { client, transport } = await connect(remote, approved.token, clients);
      const { client: local, transport: localTransport } = await connect(endpoint, other.token, clients);
      assert.equal(
        gateway.connections().reduce((sum, item) => sum + item.sessions, 0),
        2
      );
      for (const [url, token, id] of [
        [endpoint, approved.token, transport.sessionId],
        [remote, other.token, localTransport.sessionId],
        [remote, other.token, transport.sessionId],
      ]) {
        assert.equal(
          (
            await fetch(url, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}`, 'mcp-session-id': id },
            })
          ).status,
          404
        );
      }
      const task = await call(client, 'task_start', {
        cwd: workspace,
        capabilities: ['files.write'],
        idempotencyKey: 'network-task',
      });
      await call(client, 'write', {
        taskId: task.taskId,
        path: 'remote.txt',
        content: 'network evidence',
        expectedVersion: 'absent',
        idempotencyKey: 'network-write',
      });
      assert.equal(
        (await call(client, 'read', { taskId: task.taskId, path: 'remote.txt' })).text,
        'network evidence'
      );
      assert.equal(
        (await local.listTools()).tools.some((item) => item.name === 'write'),
        false
      );
      await authority.revoke(approved.grant.clientId);
      await gateway.revoke(approved.grant.clientId);
      assert.equal((await fetch(remote, { headers: auth })).status, 401);
      assert.equal(
        gateway.connections().reduce((sum, item) => sum + item.sessions, 0),
        1
      );
    },
    false,
    address
  );
});

test('failed explicit network binding closes the loopback listener instead of silently falling back', async () => {
  const address = Object.values(networkInterfaces())
    .flat()
    .find(
      (item) =>
        item &&
        !item.internal &&
        item.family === 'IPv4' &&
        networkAddressSchema.safeParse(item.address).success
    )?.address;
  assert.ok(address);
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, address, resolve);
  });
  const port = occupied.address().port;
  const failing = new HttpGateway({ close: async () => {} });
  try {
    await assert.rejects(failing.listen(port, address), { code: 'PORT_IN_USE' });
    assert.equal(failing.isListening(), false);
    assert.equal(failing.remoteEndpoint(), null);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/mcp`));
    assert.equal(occupied.listening, true);
  } finally {
    await failing.close();
    await new Promise((resolve) => occupied.close(resolve));
  }
});

/**
 * Connects an actual SDK client with a Host-issued bearer credential.
 */
async function connect(endpoint, token, clients) {
  const client = new Client({ name: 'generic-validation', version: '1' });
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

/**
 * Extracts the typed success envelope while retaining error assertions at the protocol boundary.
 */
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result.structuredContent.data;
}

test('generic MCP initializes, projects grants, writes once, queries history and rejects foreign ownership', async () => {
  await fixture(async ({ workspace, authority, endpoint, clients }) => {
    const writer = await authority.approve({
      label: 'writer',
      permissions: ['files.write'],
      waitBudgetMs: 120000,
    });
    const reader = await authority.approve({
      label: 'reader',
      permissions: ['files.read'],
      waitBudgetMs: 120000,
    });
    const { client } = await connect(endpoint, writer.token, clients);
    const { client: other } = await connect(endpoint, reader.token, clients);
    assert.deepEqual((await other.listTools()).tools.map((tool) => tool.name).sort(), [
      'find',
      'grep',
      'ls',
      'read',
      'runtime_status',
      'task_end',
      'task_start',
      'task_status',
      'task_stop',
    ]);
    const list = await client.listTools();
    assert.equal(list.tools.find((tool) => tool.name === 'task_status').inputSchema.type, 'object');
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['files.write'],
      idempotencyKey: 'creation-1',
    });
    assert.equal(
      (
        await call(client, 'task_start', {
          cwd: workspace,
          capabilities: ['files.write'],
          idempotencyKey: 'creation-1',
        })
      ).taskId,
      task.taskId
    );
    const busy = await other.callTool({
      name: 'task_start',
      arguments: { cwd: workspace, capabilities: ['files.read'], idempotencyKey: 'other-1' },
    });
    assert.equal(busy.isError, true);
    const request = {
      taskId: task.taskId,
      path: 'a.txt',
      content: 'one',
      idempotencyKey: 'write-1',
      expectedVersion: 'absent',
    };
    const first = await call(client, 'write', request);
    assert.deepEqual(await call(client, 'write', request), first);
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'one');
    assert.equal((await call(client, 'read', { taskId: task.taskId, path: 'a.txt' })).text, 'one');
    assert.equal((await call(client, 'find', { taskId: task.taskId, pattern: '*.txt' })).entries.length, 1);
    assert.equal((await call(client, 'grep', { taskId: task.taskId, pattern: 'one' })).entries.length, 1);
    assert.equal((await call(client, 'ls', { taskId: task.taskId })).entries.length, 1);
    await call(client, 'edit', {
      taskId: task.taskId,
      path: 'a.txt',
      edits: [{ oldText: 'one', newText: 'two' }],
      idempotencyKey: 'edit-1',
    });
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'two');
    assert.equal(
      (await call(client, 'task_status', { taskId: task.taskId, operationKey: 'write-1' })).operation.state,
      'completed'
    );
    const foreign = await other.callTool({ name: 'task_status', arguments: { taskId: task.taskId } });
    assert.equal(foreign.isError, true);
    await call(client, 'task_end', { taskId: task.taskId });
    assert.equal((await call(client, 'task_status', { creationKey: 'creation-1' })).task.state, 'completed');
    assert.ok(!JSON.stringify(authority.clients()).includes(writer.token));
    assert.ok(!JSON.stringify(authority.clients()).includes(writer.grant.tokenHash));
    const conflict = await client.callTool({
      name: 'task_start',
      arguments: { cwd: workspace, capabilities: ['files.read'], idempotencyKey: 'creation-1' },
    });
    assert.equal(conflict.isError, true);
    await authority.revoke(writer.grant.clientId);
    assert.throws(() => authority.authenticate(writer.token), { code: 'UNAUTHORIZED' });
    await assert.rejects(client.listTools());
  });
});

test('HTTP rejects missing bearer, browser origins, wrong host/version, session theft and oversized requests', async () => {
  await fixture(async ({ authority, endpoint, clients }) => {
    const approved = await authority.approve({
      label: 'reader',
      permissions: ['files.read'],
      waitBudgetMs: 120000,
    });
    const another = await authority.approve({
      label: 'other',
      permissions: ['files.read'],
      waitBudgetMs: 120000,
    });
    const headers = { Authorization: `Bearer ${approved.token}` };
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers: { ...headers, Origin: 'null' } })).status, 403);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(endpoint, { headers: { ...headers, Host: 'localhost' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal(
      (await fetch(endpoint, { headers: { ...headers, 'mcp-protocol-version': '2024-11-05' } })).status,
      400
    );
    assert.equal((await fetch(endpoint + '?token=' + approved.token, { headers })).status, 404);
    const { transport } = await connect(endpoint, approved.token, clients);
    assert.equal(
      (
        await fetch(endpoint, {
          headers: { Authorization: `Bearer ${another.token}`, 'mcp-session-id': transport.sessionId },
        })
      ).status,
      404
    );
    assert.equal(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: ' '.repeat(24 * 1024 * 1024 + 1),
        })
      ).status,
      413
    );
    for (let index = 0; index < 3; index++) {
      await connect(endpoint, approved.token, clients);
    }
    await assert.rejects(connect(endpoint, approved.token, clients));
  });
});

test('stop during delayed registration retains global admission until preparation drains', async () => {
  await fixture(async ({ workspace, authority, tools, store }) => {
    const approved = await authority.approve({
      label: 'writer',
      permissions: ['files.write'],
      waitBudgetMs: 120000,
    });
    const original = tools.registerTask.bind(tools);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    tools.registerTask = async (input) => {
      entered.resolve();
      await release.promise;
      await original(input);
    };
    const pending = authority.start(approved.grant.clientId, {
      cwd: workspace,
      capabilities: ['files.write'],
      idempotencyKey: 'slow',
    });
    const rejected = assert.rejects(pending, { code: 'TASK_STOPPED' });
    await entered.promise;
    const task = [...store.tasks.values()][0];
    const stop = authority.stop(approved.grant.clientId, task.taskId);
    await assert.rejects(
      authority.start(approved.grant.clientId, {
        cwd: workspace,
        capabilities: ['files.read'],
        idempotencyKey: 'blocked',
      }),
      { code: 'RESOURCE_BUSY' }
    );
    release.resolve();
    await rejected;
    assert.equal((await stop).state, 'cancelled');
    const next = await authority.start(approved.grant.clientId, {
      cwd: workspace,
      capabilities: ['files.read'],
      idempotencyKey: 'next',
    });
    assert.equal(next.state, 'active');
  });
});

for (const terminalState of ['completed', 'interrupted']) {
  test(`restart retrieves ${terminalState} write/edit summaries without reopening files or replaying mutations`, async () => {
    await fixture(async ({ workspace, authority, gateway, native, root, tools }) => {
      const approved = await authority.approve({
        label: 'file recovery',
        permissions: ['files.write'],
        waitBudgetMs: 120000,
      });
      const foreign = await authority.approve({
        label: 'foreign recovery',
        permissions: ['files.write'],
        waitBudgetMs: 120000,
      });
      const clientId = approved.grant.clientId;
      const task = await authority.start(clientId, {
        cwd: workspace,
        capabilities: ['files.write'],
        idempotencyKey: 'file-recovery-task',
      });
      const path = join(workspace, 'retained.txt');
      const write = {
        taskId: task.taskId,
        path,
        content: 'original',
        expectedVersion: 'absent',
        idempotencyKey: 'retained-write',
      };
      const written = await authority.call(clientId, 'write', write, new AbortController().signal);
      assert.deepEqual(await authority.call(clientId, 'write', write, new AbortController().signal), written);
      const edit = {
        taskId: task.taskId,
        path,
        edits: [{ oldText: 'original', newText: 'edited' }],
        idempotencyKey: 'retained-edit',
      };
      const edited = await authority.call(clientId, 'edit', edit, new AbortController().signal);
      const failed = { ...write, content: 'must not be written', idempotencyKey: 'failed-write' };
      await assert.rejects(authority.call(clientId, 'write', failed, new AbortController().signal), {
        code: 'FILE_VERSION_CONFLICT',
      });
      const journal = join(root, 'tasks', 'events.jsonl');
      if (terminalState === 'completed') {
        await authority.end(clientId, task.taskId);
      }
      const retainedHistory = await readFile(journal);
      await gateway.close();
      await tools.close();
      if (terminalState === 'interrupted') {
        // Restore the acknowledged history to model process loss before a task shutdown record.
        await writeFile(journal, retainedHistory);
      }
      await writeFile(path, 'externally changed after shutdown');
      const restoredTools = new BasicTools(await FilePublication.open(native, root));
      const restoredStore = await ControlStore.open(native, root);
      const restored = new TaskAuthority(restoredTools, restoredStore);
      try {
        assert.equal(restored.taskStatus(clientId, { taskId: task.taskId }).task.state, terminalState);
        const settledHistory = await readFile(journal);
        for (const [name, input, outcome] of [
          ['write', write, written],
          ['edit', edit, edited],
        ]) {
          const summary = await restored.call(clientId, name, input, new AbortController().signal);
          assert.deepEqual(summary, {
            retained: true,
            fileEffect: outcome.fileEffect,
            version: outcome.version,
          });
          summary.fileEffect = 'modified by consumer';
          assert.equal(
            (await restored.call(clientId, name, input, new AbortController().signal)).fileEffect,
            outcome.fileEffect
          );
          await assert.rejects(
            restored.call(foreign.grant.clientId, name, input, new AbortController().signal),
            { code: 'TASK_NOT_FOUND' }
          );
        }
        await assert.rejects(
          restored.call(
            clientId,
            'write',
            { ...write, content: 'different input' },
            new AbortController().signal
          ),
          { code: 'REQUEST_CONFLICT' }
        );
        await assert.rejects(
          restored.call(
            clientId,
            'edit',
            { ...edit, path: join(workspace, 'other.txt') },
            new AbortController().signal
          ),
          { code: 'REQUEST_CONFLICT' }
        );
        await assert.rejects(
          restored.call(
            clientId,
            'write',
            { ...write, idempotencyKey: 'new-key' },
            new AbortController().signal
          ),
          { code: 'TASK_INTERRUPTED' }
        );
        await assert.rejects(restored.call(clientId, 'write', failed, new AbortController().signal), {
          code: 'TASK_INTERRUPTED',
        });
        assert.deepEqual(await readFile(journal), settledHistory);
        assert.equal(await readFile(path, 'utf8'), 'externally changed after shutdown');
        await restored.revoke(clientId);
        await assert.rejects(restored.call(clientId, 'write', write, new AbortController().signal), {
          code: 'UNAUTHORIZED',
        });
      } finally {
        await restored.close();
        await restoredTools.close();
      }
    });
  });
}

test('restart interrupts acknowledged live tasks and retains creation keys without replay', async () => {
  await fixture(async ({ workspace, authority, gateway, native, root }) => {
    const approved = await authority.approve({
      label: 'reader',
      permissions: ['files.read'],
      waitBudgetMs: 120000,
    });
    const task = await authority.start(approved.grant.clientId, {
      cwd: workspace,
      capabilities: ['files.read'],
      idempotencyKey: 'retained',
    });
    const path = join(root, 'tasks', 'events.jsonl');
    const history = await readFile(path);
    await gateway.close();
    // Restore the complete pre-shutdown journal to simulate process loss at an acknowledged active task.
    await writeFile(path, history);
    const recovered = await ControlStore.open(native, root);
    try {
      assert.equal(recovered.tasks.get(task.taskId).state, 'interrupted');
      assert.equal(recovered.tasks.get(task.taskId).creationKey, 'retained');
      assert.equal(recovered.grants.get(approved.grant.clientId).tokenHash.includes(approved.token), false);
    } finally {
      await recovered.close();
    }
  });
});

/**
 * Waits for externally observable lifecycle with a finite deadline, without assuming process scheduling speed.
 */
async function terminal(client, taskId) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const status = await call(client, 'task_status', { taskId });
    if (status.task.state === 'cancelled' || status.operation?.state === 'completed') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Task did not reach a terminal observation within its test deadline.');
}

test('explicit SDK cancellation drains actual PowerShell before global admission opens', async () => {
  await fixture(async ({ workspace, authority, endpoint, clients, tools }) => {
    const approved = await authority.approve({
      label: 'shell',
      permissions: ['shell.execute'],
      waitBudgetMs: 120000,
    });
    const { client } = await connect(endpoint, approved.token, clients);
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['shell.execute'],
      idempotencyKey: 'cancel',
    });
    const original = tools.powershell.bind(tools);
    const entered = Promise.withResolvers();
    tools.powershell = (owner, input) => {
      const pending = original(owner, input);
      entered.resolve();
      return pending;
    };
    const controller = new AbortController();
    const pending = client.callTool(
      {
        name: 'powershell',
        arguments: {
          taskId: task.taskId,
          command: 'Start-Sleep -Seconds 30',
          idempotencyKey: 'cancelled-shell',
        },
      },
      undefined,
      { signal: controller.signal }
    );
    const rejected = assert.rejects(pending);
    await entered.promise;
    controller.abort();
    await rejected;
    assert.equal((await terminal(client, task.taskId)).task.state, 'cancelled');
    assert.equal(
      (
        await call(client, 'task_start', {
          cwd: workspace,
          capabilities: ['shell.execute'],
          idempotencyKey: 'after-cancel',
        })
      ).state,
      'active'
    );
  }, true);
});

test('HTTP disconnect preserves in-flight PowerShell and exact retry uses the original effective timeout', async () => {
  await fixture(async ({ workspace, authority, endpoint, clients, tools }) => {
    const approved = await authority.approve({
      label: 'shell',
      permissions: ['shell.execute'],
      waitBudgetMs: 120000,
    });
    const { client, transport } = await connect(endpoint, approved.token, clients);
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['shell.execute'],
      idempotencyKey: 'disconnect',
    });
    const original = tools.powershell.bind(tools);
    const entered = Promise.withResolvers();
    const finished = Promise.withResolvers();
    tools.powershell = async (owner, input) => {
      const pending = original(owner, input);
      entered.resolve();
      try {
        return await pending;
      } finally {
        finished.resolve();
      }
    };
    const args = {
      taskId: task.taskId,
      command:
        "Start-Sleep -Milliseconds 100; [IO.File]::AppendAllText([IO.Path]::Combine($PWD.Path, 'marker.txt'), 'done')",
      idempotencyKey: 'once',
      timeout: 600,
    };
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'powershell', arguments: args },
    });
    const req = request(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${approved.token}`,
        'mcp-session-id': transport.sessionId,
        'mcp-protocol-version': '2025-11-25',
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    req.on('error', () => {});
    req.end(body);
    await entered.promise;
    req.destroy();
    await finished.promise;
    let reply;
    const deadline = Date.now() + 5000;
    do {
      reply = await client.callTool({ name: 'powershell', arguments: args });
      if (!reply.isError) {
        break;
      }
      assert.equal(reply.structuredContent.data.error.code, 'ACTION_IN_PROGRESS');
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.notEqual(reply.isError, true);
    const retry = reply.structuredContent.data;
    assert.equal(retry.exitCode, 0);
    assert.equal(await readFile(join(workspace, 'marker.txt'), 'utf8'), 'done');
    assert.equal(
      (await call(client, 'task_status', { taskId: task.taskId, operationKey: 'once' })).operation.state,
      'completed'
    );
  }, true);
});

test('startup refuses immutable task tampering, lifecycle regression and truncated control records', async () => {
  await fixture(async ({ workspace, authority, gateway, native, root }) => {
    const approved = await authority.approve({
      label: 'reader',
      permissions: ['files.read'],
      waitBudgetMs: 120000,
    });
    await authority.start(approved.grant.clientId, {
      cwd: workspace,
      capabilities: ['files.read'],
      idempotencyKey: 'history',
    });
    await gateway.close();
    const path = join(root, 'tasks', 'events.jsonl');
    const text = await readFile(path, 'utf8');
    const records = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    for (const mutate of [
      (last) => {
        last.value.cwd = '..';
      },
      (last) => {
        last.value.state = 'active';
      },
    ]) {
      const modified = structuredClone(records);
      mutate(modified.at(-1));
      await writeFile(path, modified.map((record) => JSON.stringify(record)).join('\n') + '\n');
      await assert.rejects(ControlStore.open(native, root), { code: 'CONTROL_STORE_INVALID' });
    }
    await writeFile(path, text.slice(0, -1));
    await assert.rejects(ControlStore.open(native, root), { code: 'CONTROL_STORE_INVALID' });
  });
});

test('device grants expose no workspace binding, span directories and retain cwd across restart', async () => {
  await fixture(async ({ root, workspace, authority, endpoint, clients, native, gateway }) => {
    const approved = await authority.approve({
      label: 'device',
      permissions: ['files.write'],
      waitBudgetMs: 120000,
    });
    assert.equal(approved.grant.scope, 'device');
    assert.equal('root' in approved.grant, false);
    assert.equal('workspaceId' in approved.grant, false);
    const { client } = await connect(endpoint, approved.token, clients);
    const status = await call(client, 'runtime_status');
    assert.deepEqual(status.authorization, { scope: 'device', clientId: approved.grant.clientId });
    assert.deepEqual(status.device, {
      deviceId: '89b7dada-bb9d-4b25-a1ef-ff6a3e8b189a',
      deviceName: '办公电脑',
    });
    const discovered = await client.listTools();
    assert.ok(
      discovered.tools
        .find((tool) => tool.name === 'runtime_status')
        .description.includes(status.device.deviceId)
    );
    assert.ok(client.getInstructions().includes(status.device.deviceName));
    assert.equal(status.defaultCwd, homedir());
    assert.equal('workspaces' in status, false);
    for (const cwd of ['D:relative', '\\root-relative', '/c/posix', 'C:\\NUL']) {
      const invalid = await client.callTool({
        name: 'task_start',
        arguments: { capabilities: ['files.read'], cwd, idempotencyKey: 'invalid-' + cwd },
      });
      assert.equal(invalid.isError, true);
      assert.equal(invalid.structuredContent.data.error.code, 'PATH_REJECTED');
      assert.equal(authority.status(approved.grant.clientId).task, null);
    }
    const legacy = await client.callTool({
      name: 'task_start',
      arguments: { capabilities: ['files.write'], idempotencyKey: 'legacy', workspaceId: 'legacy' },
    });
    assert.equal(legacy.isError, true);
    const defaultTask = await call(client, 'task_start', {
      capabilities: ['files.read'],
      idempotencyKey: 'default',
    });
    assert.equal(defaultTask.cwd, homedir());
    await call(client, 'task_end', { taskId: defaultTask.taskId });
    const other = join(root, 'other');
    await mkdir(other);
    const task = await call(client, 'task_start', {
      cwd: workspace,
      capabilities: ['files.write'],
      idempotencyKey: 'cross-directory',
    });
    assert.equal(task.cwd, workspace);
    for (const [key, path] of [
      ['relative', '..\\other\\relative.txt'],
      ['absolute', join(other, 'absolute.txt')],
    ]) {
      await call(client, 'write', {
        taskId: task.taskId,
        path,
        content: key,
        expectedVersion: 'absent',
        idempotencyKey: key,
      });
      assert.equal((await call(client, 'read', { taskId: task.taskId, path })).text, key);
    }
    await call(client, 'edit', {
      taskId: task.taskId,
      path: join(other, 'absolute.txt'),
      edits: [{ oldText: 'absolute', newText: 'edited' }],
      idempotencyKey: 'cross-edit',
    });
    assert.equal(await readFile(join(other, 'absolute.txt'), 'utf8'), 'edited');
    await call(client, 'task_end', { taskId: task.taskId });
    const second = await call(client, 'task_start', {
      cwd: other,
      capabilities: ['files.read'],
      idempotencyKey: 'second-directory',
    });
    assert.equal(
      (await call(client, 'read', { taskId: second.taskId, path: 'absolute.txt' })).text,
      'edited'
    );
    await call(client, 'task_end', { taskId: second.taskId });
    await gateway.close();
    const reopened = await ControlStore.open(native, root);
    try {
      assert.equal(reopened.grants.get(approved.grant.clientId).scope, 'device');
      assert.equal(reopened.tasks.get(second.taskId).cwd, other);
    } finally {
      await reopened.close();
    }
  });
});
