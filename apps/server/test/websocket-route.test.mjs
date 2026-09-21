/**
 * @author Codex
 * @description Verifies that the Fastify WebSocket plugin intercepts the Session channel route before HTTP routes are registered.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { createServer } from '../dist/app.js';

test('Session channel accepts a local WebSocket upgrade', async () => {
  let runtimeCloseCount = 0;
  const runtime = {
    onControlChanged: () => () => undefined,
    onEvent: () => () => undefined,
    close: async () => {
      runtimeCloseCount += 1;
    },
  };
  const server = createServer({ databasePath: ':memory:', runtime });
  let socket;
  try {
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/ws`, {
      headers: { origin: `http://127.0.0.1:${String(address.port)}` },
    });
    await once(socket, 'open');

    assert.equal(socket.readyState, WebSocket.OPEN);
  } finally {
    socket?.close();
    await server.close();
  }
  assert.equal(runtimeCloseCount, 1);
});

test('Session channel rejects a disallowed Origin before upgrading', async () => {
  const server = createServer({
    databasePath: ':memory:',
    runtime: {
      onEvent: () => () => undefined,
      onControlChanged: () => () => undefined,
      close: async () => undefined,
    },
  });
  let socket;
  try {
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/ws`, {
      headers: { origin: 'http://untrusted.example' },
    });
    socket.on('error', () => undefined);

    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 403);
    assert.equal(JSON.parse(await readResponseBody(response)).code, 'SERVER_SETTINGS_ORIGIN_REJECTED');
    assert.notEqual(socket.readyState, WebSocket.OPEN);
  } finally {
    socket?.terminate();
    await server.close();
  }
});

test('HTTP and WebSocket reject a matching but untrusted Host and Origin', { timeout: 10_000 }, async () => {
  const server = createServer({
    databasePath: ':memory:',
    runtime: {
      onEvent: () => () => undefined,
      onControlChanged: () => () => undefined,
      close: async () => undefined,
    },
  });
  let socket;
  try {
    for (const origin of [undefined, 'http://attacker.example:3000']) {
      const response = await server.inject({
        url: '/api/settings/server',
        headers: { host: 'attacker.example:3000', ...(origin ? { origin } : {}) },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().code, 'SERVER_SETTINGS_ORIGIN_REJECTED');
    }
    await server.listen({ host: '127.0.0.1', port: 0 });
    const { port } = server.server.address();
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { host: 'attacker.example:3000', origin: 'http://attacker.example:3000' },
    });
    socket.on('error', () => undefined);
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 403);
    assert.equal(JSON.parse(await readResponseBody(response)).code, 'SERVER_SETTINGS_ORIGIN_REJECTED');
  } finally {
    socket?.terminate();
    await server.close();
  }
});

/**
 * Collects a rejected WebSocket handshake body for transport assertions.
 *
 * @param {import('node:http').IncomingMessage} response Rejected upgrade response.
 * @returns {Promise<string>} Complete response body.
 */
async function readResponseBody(response) {
  const chunks = [];
  for await (const chunk of response) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
