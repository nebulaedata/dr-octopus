/**
 * @author Codex
 * @description Verifies that active MCP connectivity probing has a dedicated static Settings route.
 */

import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { registerMcpSettingsController } from '../dist/modules/settings/mcp-settings.controller.js';

test('POST connectivity probe is not captured by the MCP Server detail route', async () => {
  const server = Fastify();
  const calls = [];
  const serverKey = `mcp1_${'a'.repeat(43)}`;
  const expected = {
    revision: 'revision-a',
    checkedAt: '2026-09-04T00:00:00.000Z',
    servers: [{ serverKey: 'server-a', status: 'connected', toolCount: 3 }],
  };
  registerMcpSettingsController(server, {
    probeConnectivity: async (requestedServerKey) => {
      calls.push(requestedServerKey);
      return expected;
    },
  });

  const response = await server.inject({
    method: 'POST',
    url: '/settings/mcp-servers/connectivity-probe',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), expected);
  const targeted = await server.inject({
    method: 'POST',
    url: `/settings/mcp-servers/${serverKey}/connectivity-probe`,
  });
  assert.equal(targeted.statusCode, 200);
  assert.deepEqual(calls, [undefined, serverKey]);
  await server.close();
});
