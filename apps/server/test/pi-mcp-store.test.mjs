/**
 * @author Codex
 * @description Verifies secret-free MCP projection, optimistic writes, and Host-owned preservation.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createPiMcpStore } from '../dist/lib/pi-mcp/index.js';

/** Creates a synchronous adapter double backed by the store's explicit Agent directory. */
function createAdapter() {
  const read = () => {
    try {
      return JSON.parse(requireRead(join(process.env.DR_OCTOPUS_CODING_AGENT_DIR, 'mcp.json')));
    } catch {
      return { mcpServers: {} };
    }
  };
  return {
    loadMcpConfig() {
      return read();
    },
    getMcpDiscoverySummary() {
      return {
        sources: [
          {
            id: 'pi-global',
            path: join(process.env.DR_OCTOPUS_CODING_AGENT_DIR, 'mcp.json'),
            serverCount: Object.keys(read().mcpServers).length,
          },
        ],
        conflicts: [],
      };
    },
    getServerProvenance() {
      const path = join(process.env.DR_OCTOPUS_CODING_AGENT_DIR, 'mcp.json');
      return new Map(Object.keys(read().mcpServers).map((name) => [name, { path, kind: 'user' }]));
    },
  };
}

/** Reads a UTF-8 fixture synchronously because the real adapter API is synchronous. */
function requireRead(path) {
  return globalThis.process.getBuiltinModule('node:fs').readFileSync(path, 'utf8');
}

test('Pi MCP store never projects literal secrets and preserves them on same-endpoint edits', async () => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-mcp-'));
  try {
    await writeFile(
      join(agentDir, 'mcp.json'),
      JSON.stringify({
        customRoot: true,
        mcpServers: {
          remote: {
            'x-dr-octopus': {
              description: 'Reads remote project data.',
              displayGroup: 'project',
            },
            url: 'https://mcp.example.test',
            headers: { Authorization: 'Bearer top-secret' },
            bearerToken: 'top-secret',
            oauth: { clientId: 'client', clientSecret: 'oauth-secret' },
            customAdapterField: 'preserve-me',
            directTools: 'search',
          },
        },
      })
    );
    const store = createPiMcpStore({ agentDir, adapterApi: createAdapter() });
    const catalog = await store.list();
    const detail = await store.get(catalog.servers[0].serverKey);
    assert.equal(JSON.stringify(detail).includes('top-secret'), false);
    assert.equal(JSON.stringify(detail).includes('oauth-secret'), false);
    assert.equal(detail.description, 'Reads remote project data.');
    assert.equal(detail.directTools, 'search');
    assert.deepEqual(detail.secretBindings, [
      { kind: 'header', name: 'Authorization' },
      { kind: 'oauth_client_secret', name: 'clientSecret' },
    ]);

    await store.update(detail.serverKey, {
      revision: catalog.revision,
      description: 'Updated remote project data.',
      connection: { type: 'http', url: 'https://mcp.example.test', transport: 'auto' },
      enabled: true,
      lifecycle: 'lazy',
      protocolVersion: 'legacy',
      exposeResources: true,
      directTools: detail.directTools,
      toolPrefix: 'server',
      includeTools: [],
      excludeTools: [],
      auth: { type: 'auto', bearerTokenStored: false },
    });
    const persisted = JSON.parse(await readFile(join(agentDir, 'mcp.json'), 'utf8'));
    assert.equal(persisted.customRoot, true);
    assert.equal(persisted.mcpServers.remote.directTools, 'search');
    assert.equal(persisted.mcpServers.remote.customAdapterField, 'preserve-me');
    assert.equal(persisted.mcpServers.remote.oauth.clientSecret, 'oauth-secret');
    assert.equal(persisted.mcpServers.remote.headers.Authorization, 'Bearer top-secret');
    assert.equal(persisted.mcpServers.remote.bearerToken, 'top-secret');
    assert.deepEqual(persisted.mcpServers.remote['x-dr-octopus'], {
      description: 'Updated remote project data.',
      displayGroup: 'project',
    });
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test('Pi MCP store rejects stale revisions before writing', async () => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-mcp-revision-'));
  try {
    const store = createPiMcpStore({ agentDir, adapterApi: createAdapter() });
    await assert.rejects(
      store.create({
        name: 'local',
        revision: 'stale',
        description: 'Local MCP server.',
        connection: { type: 'stdio', command: 'node', args: [] },
        enabled: true,
        lifecycle: 'lazy',
        protocolVersion: 'legacy',
        exposeResources: true,
        directTools: false,
        toolPrefix: 'server',
        includeTools: [],
        excludeTools: [],
        auth: { type: 'none', bearerTokenStored: false },
      }),
      (error) => error.code === 'MCP_CONFIG_REVISION_CONFLICT'
    );
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
