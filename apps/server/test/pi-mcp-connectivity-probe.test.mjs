/**
 * @author Codex
 * @description Verifies bounded, revision-scoped MCP connectivity probing without external processes or networks.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { McpConnectivityProbe } from '../dist/infrastructure/pi-mcp/connectivity-probe.js';

test('MCP connectivity probe preserves catalog order and isolates failures', async () => {
  const calls = [];
  const probe = new McpConnectivityProbe({
    cwd: process.cwd(),
    probeServer: async (entry) => {
      calls.push(entry.command);
      if (entry.command === 'broken') throw new Error('fixture failure');
      return { status: 'connected', toolCount: 2 };
    },
  });

  const result = await probe.probe('revision-a', [
    { serverKey: 'connected', entry: { command: 'working' } },
    { serverKey: 'disabled', entry: { command: 'unused', disabled: true } },
    { serverKey: 'failed', entry: { command: 'broken' } },
  ]);

  assert.deepEqual(calls.sort(), ['broken', 'working']);
  assert.deepEqual(result.servers, [
    { serverKey: 'connected', status: 'connected', toolCount: 2 },
    { serverKey: 'disabled', status: 'disabled' },
    { serverKey: 'failed', status: 'failed' },
  ]);
});

test('MCP connectivity probe coalesces and caches each Server independently', async () => {
  let callCount = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const probe = new McpConnectivityProbe({
    cwd: process.cwd(),
    probeServer: async () => {
      callCount += 1;
      await gate;
      return { status: 'connected' };
    },
  });
  const targets = [{ serverKey: 'server', entry: { command: 'fixture' } }];

  const first = probe.probe('revision-a', targets);
  const concurrent = probe.probe('revision-a', targets);
  release();
  const [result, concurrentResult] = await Promise.all([first, concurrent]);
  const cached = await probe.probe('revision-a', targets);
  await probe.probe('revision-b', targets);

  assert.equal(callCount, 2);
  assert.deepEqual(concurrentResult.servers, result.servers);
  assert.deepEqual(cached.servers, result.servers);
});

test('MCP connectivity probe reuses cached siblings during a targeted request', async () => {
  const calls = [];
  const probe = new McpConnectivityProbe({
    cwd: process.cwd(),
    probeServer: async (entry) => {
      calls.push(entry.command);
      return { status: 'connected' };
    },
  });
  const targets = [
    { serverKey: 'server-a', entry: { command: 'a' } },
    { serverKey: 'server-b', entry: { command: 'b' } },
  ];

  await probe.probe('revision-a', targets);
  await probe.probe('revision-a', [targets[1]]);
  await probe.probe('revision-b', [targets[1]]);

  assert.deepEqual(calls.sort(), ['a', 'b', 'b']);
});
