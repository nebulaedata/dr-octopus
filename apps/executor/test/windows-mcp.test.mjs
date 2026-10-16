/**
 * @author Codex
 * @description Verifies local and remote Windows-MCP discovery, explicit HTTP policy, credential isolation and connection-only stop semantics.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { windowsMcpSelectionSchema } from '../src/contracts/windows-mcp.ts';
import { WindowsMcpConnection } from '../src/runtime/computer/windows-mcp-connection.ts';

/**
 * Runs a single authenticated MCP fixture on an owned loopback listener, with deterministic rejection modes.
 */
async function remoteFixture(run, mode = 'normal') {
  const token = randomUUID();
  const methods = [];
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  const server = new McpServer({ name: mode === 'wrong-server' ? 'other' : 'windows-mcp', version: '0.8.6' });
  server.registerTool('ExecutorDesktopMeta', { inputSchema: {} }, async () => ({ content: [] }));
  if (mode === 'many-tools') {
    for (let index = 0; index < 64; index++) {
      server.registerTool('Extra' + index, { inputSchema: {} }, async () => ({ content: [] }));
    }
  }
  await server.connect(transport);
  const http = createServer((request, response) => {
    methods.push(request.method);
    if (request.headers.authorization !== 'Bearer ' + token) {
      response.writeHead(401).end();
      return;
    }
    if (mode === 'redirect') {
      response.writeHead(307, { location: '/other' }).end();
      return;
    }
    if (mode === 'oversized') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(' '.repeat(24 * 1024 * 1024 + 1));
      return;
    }
    void transport.handleRequest(request, response).catch(() => response.destroy());
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const selection = {
    transport: 'http',
    endpoint: `http://127.0.0.1:${http.address().port}/mcp`,
    credentialId: randomUUID(),
    allowInsecureHttp: true,
  };
  try {
    await run({ selection, token, methods, http });
  } finally {
    await server.close();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  }
}

test('Windows-MCP selection requires explicit HTTP approval and excludes commands and embedded secrets', () => {
  const remote = { transport: 'http', endpoint: 'https://127.0.0.1/mcp', credentialId: randomUUID() };
  assert.equal(windowsMcpSelectionSchema.parse(remote).allowInsecureHttp, false);
  assert.deepEqual(windowsMcpSelectionSchema.parse({ transport: 'stdio' }), { transport: 'stdio' });
  for (const input of [
    { transport: 'stdio', command: 'python.exe' },
    { ...remote, endpoint: 'http://10.0.0.2/mcp' },
    { ...remote, endpoint: 'HTTP://10.0.0.2/mcp' },
    { ...remote, endpoint: 'https://user:secret@desktop.example/mcp' },
    { ...remote, endpoint: 'https://desktop.example/mcp?token=secret' },
    { ...remote, endpoint: 'https://desktop.example/mcp#secret' },
    { ...remote, endpoint: 'file:///server' },
    { ...remote, token: 'secret' },
    { ...remote, headers: { arbitrary: 'value' } },
  ]) {
    assert.equal(windowsMcpSelectionSchema.safeParse(input).success, false);
  }
  assert.equal(
    windowsMcpSelectionSchema.safeParse({
      ...remote,
      endpoint: 'http://127.0.0.1/mcp',
      allowInsecureHttp: true,
    }).success,
    true
  );
});

test('loopback HTTP discovery uses bearer on every request and never enables unverified Computer tools', async () => {
  await remoteFixture(async ({ selection, token, methods }) => {
    const connection = await WindowsMcpConnection.connect(selection, { readCredential: async () => token });
    const status = connection.readStatus();
    assert.equal(status.transport, 'http');
    assert.equal(status.state, 'connected');
    assert.equal(status.serverVersion, '0.8.6');
    assert.equal(status.protocolVersion, '2025-11-25');
    assert.deepEqual(status.toolNames, ['ExecutorDesktopMeta']);
    assert.equal(status.computerAvailable, false);
    assert.equal(JSON.stringify(status).includes(token), false);
    status.toolNames.push('tampered');
    assert.deepEqual(connection.readStatus().toolNames, ['ExecutorDesktopMeta']);
    assert.equal(methods.includes('GET'), true);
    assert.equal(methods.filter((value) => value === 'POST').length >= 3, true);
    assert.deepEqual(await connection.close(), { executionStopConfirmed: false });
    assert.equal(connection.readStatus().state, 'closed');
    assert.deepEqual(await connection.close(), { executionStopConfirmed: false });
  });
});

test('HTTP authentication, redirects, oversized responses and wrong server identity fail without fallback', async () => {
  for (const mode of ['normal', 'redirect', 'oversized', 'wrong-server', 'many-tools']) {
    await remoteFixture(async ({ selection, token, methods }) => {
      await assert.rejects(
        WindowsMcpConnection.connect(selection, {
          readCredential: async () => (mode === 'normal' ? 'wrong' : token),
        }),
        /WINDOWS_MCP_CONNECTION_FAILED/
      );
      if (['normal', 'redirect', 'oversized'].includes(mode)) {
        assert.equal(methods.length, 1);
      }
    }, mode);
  }
});

test('HTTP stream loss invalidates the connection without retrying or claiming externally owned execution stopped', async () => {
  await remoteFixture(async ({ selection, token, methods, http }) => {
    const connection = await WindowsMcpConnection.connect(selection, { readCredential: async () => token });
    try {
      await delay(20);
      const requests = methods.length;
      http.closeAllConnections();
      for (let attempt = 0; attempt < 100 && connection.readStatus().state !== 'failed'; attempt++) {
        await delay(10);
      }
      assert.equal(connection.readStatus().state, 'failed');
      await delay(30);
      assert.equal(methods.length, requests);
      assert.deepEqual(await connection.close(), { executionStopConfirmed: false });
    } finally {
      await connection.close();
    }
  });
});

test('unconfirmed local owner cleanup remains failed and repeated close cannot forge confirmation', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'windows-mcp', version: '0.8.6' });
  server.registerTool('ExecutorDesktopMeta', { inputSchema: {} }, async () => ({ content: [] }));
  await server.connect(serverTransport);
  let stops = 0;
  const connection = await WindowsMcpConnection.connect(
    { transport: 'stdio' },
    {
      openLocal: async () => ({
        transport: clientTransport,
        stop: async () => {
          stops++;
          throw new Error('Owner exit unconfirmed');
        },
      }),
    }
  );
  try {
    await assert.rejects(connection.close(), /WINDOWS_MCP_CLEANUP_UNCONFIRMED/);
    assert.equal(connection.readStatus().state, 'failed');
    await assert.rejects(connection.close(), /WINDOWS_MCP_CLEANUP_UNCONFIRMED/);
    assert.equal(stops, 1);
  } finally {
    await server.close();
  }
});

test('local discovery owns its exact stdio fixture and confirms exit through the trusted owner', async () => {
  let pid;
  let stops = 0;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/windows-mcp.mjs', import.meta.url))],
    stderr: 'pipe',
    maxBufferSize: 24 * 1024 * 1024,
  });
  transport.stderr.resume();
  const connection = await WindowsMcpConnection.connect(
    { transport: 'stdio' },
    {
      openLocal: async () => ({
        transport,
        /**
         * Confirms only this test's child exited; product process-tree supervision remains a separate gate.
         */
        stop: async () => {
          stops++;
          await transport.close();
          for (let attempt = 0; attempt < 100; attempt++) {
            try {
              process.kill(pid, 0);
            } catch {
              return;
            }
            await delay(10);
          }
          throw new Error('Fixture exit not confirmed');
        },
      }),
    }
  );
  pid = transport.pid;
  try {
    assert.ok(pid > 0);
    assert.equal(connection.readStatus().state, 'connected');
    assert.equal(connection.readStatus().computerAvailable, false);
    assert.deepEqual(await connection.close(), { executionStopConfirmed: true });
    assert.equal(stops, 1);
  } finally {
    await connection.close();
  }
});

test('missing local resources never fall back, and pre-cancelled initialization opens no backend', async () => {
  await assert.rejects(
    WindowsMcpConnection.connect({ transport: 'stdio' }, {}),
    /WINDOWS_MCP_CONNECTION_FAILED/
  );
  let opened = false;
  await assert.rejects(
    WindowsMcpConnection.connect(
      { transport: 'stdio' },
      {
        openLocal: async () => {
          opened = true;
          throw new Error('not expected');
        },
      },
      AbortSignal.abort()
    ),
    /WINDOWS_MCP_CONNECTION_FAILED/
  );
  assert.equal(opened, false);
});

test('silent owned initialization remains bounded and confirms cleanup without retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const [transport, backend] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'windows-mcp', version: '0.8.6' });
  await server.connect(backend);
  let initialized;
  const sent = new Promise((resolve) => {
    initialized = resolve;
  });
  let requests = 0;
  let stops = 0;
  transport.send = async (message) => {
    if (message.method === 'initialize') {
      requests += 1;
      initialized();
    }
  };
  try {
    const rejected = assert.rejects(
      WindowsMcpConnection.connect(
        { transport: 'stdio' },
        {
          openLocal: async () => ({
            transport,
            stop: async () => {
              stops += 1;
            },
          }),
        }
      ),
      /WINDOWS_MCP_INITIALIZATION_TIMEOUT/
    );
    await sent;
    context.mock.timers.tick(10000);
    assert.equal(stops, 0);
    assert.equal(requests, 1);
    context.mock.timers.tick(20000);
    await rejected;
    assert.equal(requests, 1);
    assert.equal(stops, 1);
  } finally {
    await server.close();
  }
});

test('owned startup can initialize after ten seconds without retrying or enabling unverified control', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const [transport, backend] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'windows-mcp', version: '0.8.6' });
  server.registerTool('ExecutorDesktopMeta', { inputSchema: {} }, async () => ({ content: [] }));
  await server.connect(backend);
  const send = transport.send.bind(transport);
  let announce;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  let requests = 0;
  let stops = 0;
  transport.send = async (message) => {
    if (message.method === 'initialize') {
      requests++;
      const waiting = new Promise((resolve) => setTimeout(resolve, 12000));
      announce();
      await waiting;
    }
    await send(message);
  };
  let connection;
  try {
    const pending = WindowsMcpConnection.connect(
      { transport: 'stdio' },
      {
        openLocal: async () => ({
          transport,
          stop: async () => {
            stops++;
          },
        }),
      }
    );
    await started;
    context.mock.timers.tick(12000);
    connection = await pending;
    assert.equal(connection.readStatus().state, 'connected');
    assert.equal(connection.readStatus().computerAvailable, false);
    assert.equal(requests, 1);
    assert.deepEqual(await connection.close(), { executionStopConfirmed: true });
    assert.equal(stops, 1);
  } finally {
    await connection?.close();
    await server.close();
  }
});

test('owned tool discovery still times out after ten seconds and cleans once without retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const [transport, backend] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'windows-mcp', version: '0.8.6' });
  server.registerTool('ExecutorDesktopMeta', { inputSchema: {} }, async () => ({ content: [] }));
  await server.connect(backend);
  const send = transport.send.bind(transport);
  let announce;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  let requests = 0;
  let stops = 0;
  transport.send = async (message) => {
    if (message.method === 'tools/list') {
      requests++;
      announce();
      return;
    }
    await send(message);
  };
  try {
    const rejected = assert.rejects(
      WindowsMcpConnection.connect(
        { transport: 'stdio' },
        {
          openLocal: async () => ({
            transport,
            stop: async () => {
              stops++;
            },
          }),
        }
      ),
      /WINDOWS_MCP_INITIALIZATION_TIMEOUT/
    );
    await started;
    context.mock.timers.tick(10000);
    await rejected;
    assert.equal(requests, 1);
    assert.equal(stops, 1);
  } finally {
    await server.close();
  }
});

test('overall owned initialization deadline cancels delayed acquisition and drains its eventual owner', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let acquire;
  let announce;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  let starts = 0;
  let stops = 0;
  const pending = WindowsMcpConnection.connect(
    { transport: 'stdio' },
    {
      openLocal: async () => {
        const owner = new Promise((resolve) => {
          acquire = resolve;
        });
        announce();
        return owner;
      },
    }
  );
  const rejected = assert.rejects(pending, /WINDOWS_MCP_INITIALIZATION_TIMEOUT/);
  await started;
  context.mock.timers.tick(45000);
  acquire({
    transport: {
      start: async () => {
        starts++;
      },
      send: async () => {},
      close: async () => {},
    },
    stop: async () => {
      stops++;
    },
  });
  await rejected;
  assert.equal(starts, 0);
  assert.equal(stops, 1);
});

test('cancellation during local owner acquisition cleans the eventual owner before returning failure', async () => {
  const abort = new AbortController();
  let stops = 0;
  let starts = 0;
  await assert.rejects(
    WindowsMcpConnection.connect(
      { transport: 'stdio' },
      {
        openLocal: async () => {
          abort.abort();
          return {
            transport: {
              start: async () => {
                starts++;
              },
              send: async () => {},
              close: async () => {},
            },
            stop: async () => {
              stops++;
            },
          };
        },
      },
      abort.signal
    ),
    /WINDOWS_MCP_CONNECTION_FAILED/
  );
  assert.equal(starts, 0);
  assert.equal(stops, 1);
});
