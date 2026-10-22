/**
 * @author Codex
 * @description Verifies the real fixed launcher, private Node and stdio protocol against one native Runtime authority, including cancellation and failure lifetimes.
 */
import assert from 'node:assert/strict';
import { policyToolNameSchema } from '../../src/contracts/tool-policy.ts';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { testNodeResources } from '../fixtures/node-resources.mjs';
import { ShellExecutor } from '../../src/runtime/basic/shell-executor.ts';
import { SearchTools } from '../../src/runtime/basic/search-tools.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const launcher = join(dist, 'native/mcp-launcher.exe');
const run = promisify(execFile);
/**
 * Owns isolated workspaces, protocol clients and a single real authority; never starts a desktop Runtime.
 */
async function fixture(run) {
  const prefix = join(tmpdir(), 'octopus-stdio-http-');
  const root = await mkdtemp(prefix);
  const workspace = join(root, '中文 workspace');
  await mkdir(workspace);
  const native = new NativeFileCommit(join(dist, 'native/file-commit.node'));
  const publication = await FilePublication.open(native, root);
  const shell = await ShellExecutor.open(
    join(dist, 'native/process-supervisor.exe'),
    root,
    native,
    await testNodeResources(dist, native)
  );
  const search = new SearchTools(
    join(dist, 'native/process-supervisor.exe'),
    join(dist, 'resources/search'),
    root,
    native
  );
  await search.verify();
  const tools = new BasicTools(publication, shell, search);
  const authority = new TaskAuthority(tools, await ControlStore.open(native, root));
  authority.setToolPolicy(policyToolNameSchema.options, 0);
  const gateway = new HttpGateway(authority);
  const endpoint = await gateway.listen(0);
  const grant = await authority.approve({
    label: 'stdio fixture',
    permissions: ['files.write', 'shell.execute'],
    waitBudgetMs: 120000,
  });
  const clients = [];
  /**
   * Writes a new SID-private identity; a stdio launch record references only its own file and fixed package launcher.
   */
  async function config(name, url = endpoint, token = grant.token) {
    const path = join(root, name + '.json');
    assert.equal(
      (
        await native.writePrivateConfig(
          path,
          JSON.stringify({
            protocolVersion: '2025-11-25',
            clientId: grant.grant.clientId,
            scope: 'device',
            runtime: { url, headers: { Authorization: 'Bearer ' + token } },
            mcpServers: {
              'octopus-executor': { command: launcher, args: ['--mcp-stdio', '--config', path] },
            },
          })
        )
      ).ok,
      true
    );
    return path;
  }
  /**
   * Starts the production executable with hostile Node environment values to prove they cannot alter the fixed child.
   */
  async function connect(path) {
    const client = new Client({ name: 'stdio validation', version: '1' });
    const transport = new StdioClientTransport({
      command: launcher,
      args: ['--mcp-stdio', '--config', path],
      cwd: workspace,
      env: {
        PATH: 'Z:\\not-a-system-runtime',
        NODE_OPTIONS: '--require ' + join(root, 'injected.cjs'),
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: 'http://127.0.0.1:1',
      },
      stderr: 'pipe',
    });
    let diagnostics = '';
    transport.stderr.on('data', (bytes) => {
      diagnostics = (diagnostics + bytes.toString()).slice(-4096);
    });
    clients.push(client);
    await client.connect(transport);
    return { client, transport, diagnostics: () => diagnostics };
  }
  try {
    await run({ root, workspace, native, tools, authority, gateway, endpoint, grant, config, connect });
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await gateway.close();
    await tools.close();
    assert.ok(root.startsWith(prefix));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
/**
 * Checks the public MCP tool envelope and returns only confirmed success data.
 */
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result.structuredContent.data;
}
/**
 * Waits for observable authority state under a finite deadline, without repeating actions.
 */
async function until(check) {
  const deadline = Date.now() + 10000;
  do {
    if (await check()) {
      return;
    }
    await new Promise((accept) => setTimeout(accept, 25));
  } while (Date.now() < deadline);
  assert.fail('Owned stdio state did not converge.');
}

test(
  'real fixed stdio launcher preserves concurrent IDs and all seven Basic tools on one authority without environment injection',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ root, workspace, gateway, grant, config, connect }) => {
      await writeFile(join(root, 'injected.cjs'), 'throw new Error("must never load");');
      const { client, transport, diagnostics } = await connect(await config('private connection'));
      await until(() => gateway.connections().length === 1);
      assert.deepEqual(gateway.connections(), [{ clientId: grant.grant.clientId, sessions: 1 }]);
      await Promise.all(Array.from({ length: 6 }, () => client.listTools()));
      const task = await call(client, 'task_start', {
        cwd: workspace,
        capabilities: ['files.write', 'shell.execute'],
        idempotencyKey: 'stdio-task',
      });
      const common = { taskId: task.taskId };
      const write = {
        ...common,
        path: '中文.txt',
        content: 'first\r\n',
        expectedVersion: 'absent',
        idempotencyKey: 'write',
      };
      assert.deepEqual(await call(client, 'write', write), await call(client, 'write', write));
      await call(client, 'read', { ...common, path: '中文.txt' });
      await call(client, 'edit', {
        ...common,
        path: '中文.txt',
        edits: [{ oldText: 'first', newText: 'changed' }],
        idempotencyKey: 'edit',
      });
      await call(client, 'ls', { ...common });
      await call(client, 'find', { ...common, pattern: '*.txt' });
      await call(client, 'grep', { ...common, pattern: 'changed' });
      await call(client, 'powershell', {
        ...common,
        command: "[IO.File]::AppendAllText([IO.Path]::Combine($PWD.Path, 'marker.txt'), 'once')",
        idempotencyKey: 'powershell',
      });
      assert.equal(await readFile(join(workspace, '中文.txt'), 'utf8'), 'changed\r\n');
      assert.equal(await readFile(join(workspace, 'marker.txt'), 'utf8'), 'once');
      await call(client, 'task_end', common);
      assert.equal(diagnostics(), '');
      const pid = transport.pid;
      await client.close();
      await until(() => gateway.connections().length === 0);
      assert.throws(() => process.kill(pid, 0));
    });
  }
);

test(
  'stdio explicit cancellation reaches the owned PowerShell Job and EOF releases the session without ending Runtime',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ workspace, tools, authority, gateway, grant, config, connect }) => {
      const { client } = await connect(await config('cancel'));
      const task = await call(client, 'task_start', {
        cwd: workspace,
        capabilities: ['shell.execute'],
        idempotencyKey: 'cancel-task',
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
            idempotencyKey: 'cancel-powershell',
          },
        },
        undefined,
        { signal: controller.signal }
      );
      const rejected = assert.rejects(pending);
      await entered.promise;
      controller.abort();
      await rejected;
      await until(
        () => authority.taskStatus(grant.grant.clientId, { taskId: task.taskId }).task.state === 'cancelled'
      );
      await client.close();
      await until(() => gateway.connections().length === 0);
      assert.equal(gateway.isListening(), true);
      const next = await connect(await config('after-cancel'));
      await call(next.client, 'task_start', {
        cwd: workspace,
        capabilities: ['files.read'],
        idempotencyKey: 'after-cancel',
      });
    });
  }
);

test(
  'revocation and Runtime shutdown end an idle stdio process without reconnecting or replacing the Runtime',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ authority, gateway, grant, config, connect }) => {
      const { client, transport } = await connect(await config('revoke'));
      const pid = transport.pid;
      const closed = Promise.withResolvers();
      client.onclose = () => closed.resolve();
      await authority.revoke(grant.grant.clientId);
      await gateway.revoke(grant.grant.clientId);
      await Promise.race([
        closed.promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Revoked stdio remained alive')), 10000).unref()
        ),
      ]);
      await client.close();
      assert.throws(
        () => process.kill(pid, 0),
        (error) => error.code === 'ESRCH'
      );
      assert.equal(gateway.isListening(), true);
    });
    await fixture(async ({ gateway, config, connect }) => {
      const { client, transport } = await connect(await config('runtime-exit'));
      const pid = transport.pid;
      await gateway.close();
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      await client.close();
    });
  }
);

test(
  'offline, wrong credentials and malformed stdio fail closed with protocol-only stdout and safe diagnostics',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ root, gateway, config, connect }) => {
      await assert.rejects(connect(await config('wrong-role', undefined, '0'.repeat(64))));
      const incomplete = join(root, 'incomplete', 'bridge');
      await mkdir(incomplete, { recursive: true });
      await copyFile(join(dist, 'bridge/mcp-stdio.cjs'), join(incomplete, 'mcp-stdio.cjs'));
      const missing = await run(join(dist, 'resources/node/node.exe'), [join(incomplete, 'mcp-stdio.cjs')], {
        windowsHide: true,
        timeout: 7000,
      }).then(
        () => assert.fail('A missing shutdown resource must fail closed.'),
        (error) => error
      );
      assert.equal(missing.code, 1);
      assert.equal(missing.stdout, '');
      assert.equal(missing.stderr.trim(), '[mcp-stdio] Connection ended.');
      assert.equal(missing.stderr.includes(root), false);
      const path = await config('bad-frame');
      for (const args of [
        ['--mcp-stdio', '--config', path],
        ['--mcp-stdio', '--config', 'relative.json'],
      ]) {
        const child = spawn(launcher, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (bytes) => {
          stdout += bytes;
        });
        child.stderr.on('data', (bytes) => {
          stderr += bytes;
        });
        const closed = once(child, 'exit');
        child.stdin.on('error', () => {});
        child.stdin.end('not JSON\n');
        const [code] = await closed;
        assert.notEqual(code, 0);
        assert.equal(stdout, '');
        assert.ok(stderr.length < 256);
      }
      await gateway.close();
      await assert.rejects(connect(await config('offline')));
      assert.equal(gateway.isListening(), false);
    });
  }
);

test(
  'stdio response loss after an actual action never reconnects or replays; explicit same-key recovery uses Runtime history',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ endpoint, workspace, tools, config, connect }) => {
      let dispatched = 0;
      const original = tools.powershell.bind(tools);
      tools.powershell = (owner, input) => {
        dispatched++;
        return original(owner, input);
      };
      let dropped = false;
      const relay = createServer((request, response) => {
        void (async () => {
          const chunks = [];
          for await (const chunk of request) {
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          const controller = new AbortController();
          response.once('close', () => {
            if (!response.writableFinished) {
              controller.abort();
            }
          });
          const headers = {};
          for (const name of [
            'authorization',
            'accept',
            'content-type',
            'mcp-session-id',
            'mcp-protocol-version',
          ]) {
            if (request.headers[name]) {
              headers[name] = request.headers[name];
            }
          }
          const upstream = await fetch(endpoint, {
            method: request.method,
            headers,
            signal: controller.signal,
            ...(request.method === 'POST' ? { body } : {}),
          });
          const message = body.length ? JSON.parse(body) : null;
          if (!dropped && message?.params?.arguments?.idempotencyKey === 'response-loss') {
            await upstream.arrayBuffer();
            dropped = true;
            response.destroy();
            return;
          }
          response.writeHead(
            upstream.status,
            Object.fromEntries(
              [...upstream.headers].filter(([name]) => ['content-type', 'mcp-session-id'].includes(name))
            )
          );
          if (upstream.body) {
            Readable.fromWeb(upstream.body)
              .on('error', () => response.destroy())
              .pipe(response);
          } else {
            response.end();
          }
        })().catch(() => response.destroy());
      });
      relay.listen(0, '127.0.0.1');
      await once(relay, 'listening');
      try {
        const path = await config('response loss', 'http://127.0.0.1:' + relay.address().port + '/mcp');
        const first = await connect(path);
        const task = await call(first.client, 'task_start', {
          cwd: workspace,
          capabilities: ['shell.execute'],
          idempotencyKey: 'loss-task',
        });
        const action = {
          taskId: task.taskId,
          command: "[IO.File]::AppendAllText([IO.Path]::Combine($PWD.Path, 'loss-marker.txt'), 'once')",
          idempotencyKey: 'response-loss',
        };
        await assert.rejects(call(first.client, 'powershell', action));
        await first.client.close();
        assert.equal(dispatched, 1);
        assert.equal(await readFile(join(workspace, 'loss-marker.txt'), 'utf8'), 'once');
        const second = await connect(path);
        assert.equal(dispatched, 1, 'A fresh connection must not recover by resending actions.');
        await call(second.client, 'powershell', action);
        assert.equal(await readFile(join(workspace, 'loss-marker.txt'), 'utf8'), 'once');
        // The authority can invoke BasicTools to retrieve its sealed result; the command side effect remains single.
        await second.client.close();
      } finally {
        relay.closeAllConnections();
        await new Promise((accept) => relay.close(accept));
      }
    });
  }
);

test(
  'terminating only the owned native launcher closes its Job and exact private Node descendant',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ config }) => {
      const child = spawn(launcher, ['--mcp-stdio', '--config', await config('parent loss')], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.resume();
      child.stderr.resume();
      child.stdin.on('error', () => {});
      const exited = once(child, 'exit');
      try {
        let nodePid;
        await until(async () => {
          const result = await run(
            join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${child.pid} AND Name='node.exe'").ProcessId`,
            ],
            { windowsHide: true }
          );
          nodePid = Number(result.stdout.trim());
          return Number.isInteger(nodePid) && nodePid > 0;
        });
        assert.doesNotThrow(() => process.kill(nodePid, 0));
        child.kill();
        await exited;
        await until(() => {
          try {
            process.kill(nodePid, 0);
            return false;
          } catch (error) {
            return error.code === 'ESRCH';
          }
        });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
        await exited;
      }
    });
  }
);

test(
  'stdio normal EOF closes the actual pipe and exits cleanly without client-side termination',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ gateway, config }) => {
      const child = spawn(launcher, ['--mcp-stdio', '--config', await config('normal EOF')], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const exited = once(child, 'exit');
      let output = '';
      child.stdout.on('data', (bytes) => {
        output += bytes;
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      let deadline;
      try {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'normal-eof-fixture', version: '1' },
            },
          }) +
            '\n' +
            '{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
        );
        await until(() => gateway.connections().length === 1 && output.includes('\n'));
        child.stdin.end(() => child.stdin.destroy());
        const [code] = await Promise.race([
          exited,
          new Promise((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Normal EOF did not end the adapter.')), 7000);
          }),
        ]);
        assert.equal(code, 0);
        assert.equal(JSON.parse(output.trim()).result.protocolVersion, '2025-11-25');
        await until(() => gateway.connections().length === 0);
        assert.equal(gateway.isListening(), true);
      } finally {
        clearTimeout(deadline);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
        await exited;
      }
    });
  }
);

test(
  'stdio EOF exits within its process deadline even when the real output pipe is blocked, leaving Runtime alive',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ workspace, tools, gateway, config }) => {
      await writeFile(join(workspace, 'backpressure.txt'), '\u0001'.repeat(50 * 1024));
      const child = spawn(launcher, ['--mcp-stdio', '--config', await config('blocked output')], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const exited = once(child, 'exit');
      let diagnostics = '';
      child.stderr.on('data', (bytes) => {
        diagnostics = (diagnostics + bytes).slice(-1024);
      });
      child.stdin.on('error', () => {});
      const responses = new Map();
      let text = '';
      /**
       * Consumes only the handshake and task responses; the action response deliberately has no reader.
       */
      const consume = (bytes) => {
        text += bytes.toString('utf8');
        let newline;
        while ((newline = text.indexOf('\n')) >= 0) {
          const response = JSON.parse(text.slice(0, newline));
          text = text.slice(newline + 1);
          responses.get(response.id)?.resolve(response);
          responses.delete(response.id);
        }
      };
      child.stdout.on('data', consume);
      /**
       * Waits for one actual protocol response before switching stdout to a blocked consumer.
       */
      async function request(id, method, params) {
        const response = Promise.withResolvers();
        responses.set(id, response);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        const timer = setTimeout(
          () => response.reject(new Error('Fixture response missing: ' + method)),
          5000
        );
        try {
          return await response.promise;
        } finally {
          clearTimeout(timer);
        }
      }
      try {
        const initialized = await request(1, 'initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'blocked-output-fixture', version: '1' },
        });
        assert.equal(initialized.result.protocolVersion, '2025-11-25');
        child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
        const started = await request(2, 'tools/call', {
          name: 'task_start',
          arguments: { cwd: workspace, capabilities: ['files.read'], idempotencyKey: 'blocked-output-task' },
        });
        assert.notEqual(started.result.isError, true);
        const taskId = started.result.structuredContent.data.taskId;
        let readDone = false;
        const original = tools.read.bind(tools);
        tools.read = async (owner, input) => {
          const result = await original(owner, input);
          readDone = true;
          return result;
        };
        child.stdout.pause();
        child.stdout.removeListener('data', consume);
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'read', arguments: { taskId, path: 'backpressure.txt' } },
          }) + '\n'
        );
        await until(() => readDone);
        await until(() => child.stdout.readableLength > 0);
        const eof = Date.now();
        child.stdin.end(() => child.stdin.destroy());
        let deadline;
        let code;
        try {
          [code] = await Promise.race([
            exited,
            new Promise((_, reject) => {
              deadline = setTimeout(
                () => reject(new Error('Owned adapter did not exit after EOF: ' + diagnostics)),
                7000
              );
            }),
          ]);
        } finally {
          clearTimeout(deadline);
        }
        assert.equal(
          code,
          1,
          'Blocked output must use the adapter deadline rather than report a clean flush.'
        );
        assert.ok(Date.now() - eof < 7000, 'The five-second deadline must bound the owned process exit.');
        await until(() => gateway.connections().length === 0);
        assert.equal(gateway.isListening(), true);
      } finally {
        child.stdout.resume();
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
        await exited;
      }
    });
  }
);

test(
  'stdio never follows redirects and refuses oversized or invalid UTF-8 HTTP responses before output',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ config, connect }) => {
      let redirected = 0;
      const destination = createServer((_request, response) => {
        redirected++;
        response.end();
      });
      destination.listen(0, '127.0.0.1');
      await once(destination, 'listening');
      try {
        for (const mode of ['redirect', 'oversized', 'utf8']) {
          const server = createServer((_request, response) => {
            if (mode === 'redirect') {
              response.writeHead(307, {
                Location: 'http://127.0.0.1:' + destination.address().port + '/mcp',
              });
              response.end();
            } else {
              response.writeHead(200, { 'Content-Type': 'application/json' });
              response.end(
                mode === 'oversized' ? Buffer.alloc(24 * 1024 * 1024 + 1, 32) : Buffer.from([0xff, 0xfe])
              );
            }
          });
          server.listen(0, '127.0.0.1');
          await once(server, 'listening');
          try {
            await assert.rejects(
              connect(await config(mode, 'http://127.0.0.1:' + server.address().port + '/mcp'))
            );
          } finally {
            server.closeAllConnections();
            await new Promise((accept) => server.close(accept));
          }
        }
        assert.equal(redirected, 0);
      } finally {
        destination.closeAllConnections();
        await new Promise((accept) => destination.close(accept));
      }
    });
  }
);
