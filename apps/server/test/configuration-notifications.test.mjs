/**
 * @author Codex
 * @description Verifies committed Settings and scoped Skill notifications reach resident sessions without automatic restarts.
 */
import { createTestCoordinator, configurationFor } from './fixtures/configuration-runtime.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import mcpSettings from '../dist/modules/mcp-settings/index.js';
import environmentSettings from '../dist/modules/environment-settings/index.js';
import jevSettings from '../dist/modules/jev-settings/index.js';
import skills from '../dist/modules/skills/index.js';
import { ServerConfiguration } from '../dist/modules/server-settings/server-settings.service.js';

/**
 * Mounts the production module entrypoints with an isolated Agent home and real supervised fixture processes.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-config-notices-'));
  const agentDir = join(root, 'agent');
  const serverDir = join(root, 'server');
  await mkdir(agentDir);
  const runtime = createTestCoordinator({
    processOptions: {
      agentDir,
      entryPath: fileURLToPath(new URL('./fixtures/mock-rpc-entry.mjs', import.meta.url)),
      childEnvironment: { MOCK_SESSION_ID: 'pi-session' },
    },
  });
  const app = Fastify();
  app.decorate('sessionRuntime', runtime);
  app.decorate('configurationChanges', configurationFor(runtime));
  app.register(
    fp(
      (server, _options, done) => {
        server.decorate('serverConfiguration', new ServerConfiguration(serverDir, undefined, {}));
        done();
      },
      { name: 'server-settings' }
    )
  );
  app.register(
    fp(
      (server, _options, done) => {
        server.decorate('workspacesService', {
          async resolve({ id }) {
            return { id, cwd: join(root, id) };
          },
        });
        done();
      },
      { name: 'workspaces' }
    )
  );
  const options = { prefix: '/api', config: { agentDir, paths: { dataDir: serverDir } } };
  app.register(mcpSettings, options);
  app.register(environmentSettings, options);
  app.register(jevSettings, options);
  app.register(skills, options);
  t.after(async () => {
    await app.close();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });
  await app.ready();
  return { root, agentDir, app, runtime };
}

/**
 * Opens a durable empty Session in the requested Workspace without contacting a model provider.
 */
async function activate({ root, runtime }, workspaceId) {
  const cwd = join(root, workspaceId);
  await mkdir(cwd, { recursive: true });
  const sessionPath = join(cwd, 'session.jsonl');
  await writeFile(
    sessionPath,
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'pi-session',
      cwd,
      timestamp: new Date(0).toISOString(),
    }) + '\n'
  );
  const input = {
    sessionId: workspaceId + '-session',
    expectedAgentSessionId: 'pi-session',
    sessionPath,
    workspace: {
      id: workspaceId,
      cwd,
      name: workspaceId,
      slug: workspaceId,
      kind: 'project',
      schemaVersion: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  };
  return { input, binding: await runtime.activateExisting(input) };
}

test('MCP HTTP commits notify old instances without restarting them; explicit restart clears the notice', async (t) => {
  const context = await fixture(t);
  const { app, runtime } = context;
  const { input, binding } = await activate(context, 'workspace-a');
  let notices = 0;
  runtime.onControlChanged(() => notices++);
  const catalog = (await app.inject('/api/settings/mcp-servers')).json();
  const payload = {
    revision: catalog.revision,
    name: 'local',
    connection: { type: 'stdio', command: 'node', args: [] },
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/settings/mcp-servers',
    payload,
    headers: { 'idempotency-key': '7b34291a-c1aa-44c5-a3de-45bc74cf2f83' },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(notices, 1);
  assert.deepEqual(runtime.getControl(input.sessionId).changedConfigRoutes, ['/settings/mcp-servers']);
  assert.equal(runtime.getBindingBySessionId(input.sessionId).runtimeId, binding.runtimeId);
  assert.equal(runtime.getControl(input.sessionId).restartOnIdle, false);
  const replay = await app.inject({
    method: 'POST',
    url: '/api/settings/mcp-servers',
    payload,
    headers: { 'idempotency-key': '7b34291a-c1aa-44c5-a3de-45bc74cf2f83' },
  });
  assert.equal(replay.statusCode, 201);
  assert.equal(notices, 1);
  const restarted = await runtime.restart(input, {
    expectedRuntime: { runtimeId: binding.runtimeId, epoch: binding.epoch },
    allowInterrupt: false,
  });
  assert.equal(restarted.agentSessionId, binding.agentSessionId);
  assert.notEqual(restarted.runtimeId, binding.runtimeId);
  assert.equal(runtime.getControl(input.sessionId).restartRequired, false);
});

test('Agent environment and Jev credentials notify; no-op, rejected, Server and Jev model edits do not', async (t) => {
  const { app, runtime, agentDir } = await fixture(t);
  const environment = (await app.inject('/api/settings/environment/agent')).json();
  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/settings/environment/agent',
    payload: { revision: environment.revision, changes: { CONFIG_TEST_KEY: 'private-fixture' } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.doesNotMatch(saved.body, /private-fixture/);
  assert.equal(configurationFor(runtime).current(), 1);
  const unchanged = await app.inject({
    method: 'PATCH',
    url: '/api/settings/environment/agent',
    payload: { revision: saved.json().revision, changes: { CONFIG_TEST_KEY: 'private-fixture' } },
  });
  assert.equal(unchanged.statusCode, 200);
  const rejected = await app.inject({
    method: 'PATCH',
    url: '/api/settings/environment/agent',
    payload: { revision: environment.revision, changes: { CONFIG_TEST_KEY: 'other' } },
  });
  assert.equal(rejected.statusCode, 409);
  const server = (await app.inject('/api/settings/environment/server')).json();
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/settings/environment/server',
        payload: { revision: server.revision, changes: { SERVER_PORT: '3210' } },
      })
    ).statusCode,
    200
  );
  assert.equal(configurationFor(runtime).current(), 1);
  const jev = (await app.inject('/api/settings/jev')).json();
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/settings/jev',
        payload: { revision: jev.revision, model: 'jev-latest' },
      })
    ).statusCode,
    200
  );
  assert.equal(configurationFor(runtime).current(), 1);
  const credential = await app.inject({
    method: 'PATCH',
    url: '/api/settings/jev/credential',
    payload: { revision: jev.environmentRevision, apiKey: 'fixture-key' },
  });
  assert.equal(credential.statusCode, 200, credential.body);
  assert.doesNotMatch(credential.body, /fixture-key/);
  assert.equal(configurationFor(runtime).current(), 2);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/settings/jev/credential',
        payload: { revision: credential.json().environmentRevision, apiKey: 'fixture-key' },
      })
    ).statusCode,
    200
  );
  assert.equal(configurationFor(runtime).current(), 2);
  await writeFile(join(agentDir, 'jev.json'), 'invalid configuration');
  const committedButUnprojectable = await app.inject({
    method: 'PATCH',
    url: '/api/settings/jev/credential',
    payload: { revision: credential.json().environmentRevision, apiKey: 'replacement-fixture-key' },
  });
  assert.equal(committedButUnprojectable.statusCode, 400);
  assert.doesNotMatch(committedButUnprojectable.body, /replacement-fixture-key/);
  assert.equal(configurationFor(runtime).current(), 3);
  assert.equal(runtime.getDiagnostics().activeRuntimeCount, 0);
});

test('Workspace Skills notify only their own sessions; global Skills notify all resident sessions', async (t) => {
  const context = await fixture(t);
  const { app, runtime } = context;
  const a = await activate(context, 'workspace-a');
  const b = await activate(context, 'workspace-b');
  const payload = {
    name: 'notice-test',
    description: 'Tests configuration notices.',
    body: 'Follow fixture rules.',
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/workspaces/workspace-a/skills',
    payload,
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(runtime.getControl(a.input.sessionId).restartRequired, true);
  assert.equal(runtime.getControl(b.input.sessionId).restartRequired, false);
  const before = configurationFor(runtime).current();
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/workspaces/workspace-a/skills/notice-test',
        payload: { description: payload.description, body: payload.body },
      })
    ).statusCode,
    200
  );
  assert.equal(configurationFor(runtime).current(), before);
  assert.equal((await app.inject({ method: 'POST', url: '/api/skills', payload })).statusCode, 201);
  assert.equal(runtime.getControl(b.input.sessionId).restartRequired, true);
  const rejected = await app.inject({ method: 'POST', url: '/api/skills', payload });
  assert.equal(rejected.statusCode, 409);
  const afterGlobal = configurationFor(runtime).current();
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/skills/notice-test',
        payload: { description: payload.description, body: 'Updated fixture rules.' },
      })
    ).statusCode,
    200
  );
  assert.equal(configurationFor(runtime).current(), afterGlobal + 1);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/skills/upload',
        payload: {
          filename: 'uploaded.md',
          data: Buffer.from(
            '---\nname: uploaded\ndescription: Uploaded fixture rules.\n---\n\nFollow rules.\n'
          ).toString('base64'),
        },
      })
    ).statusCode,
    201
  );
  assert.equal(configurationFor(runtime).current(), afterGlobal + 2);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/skills/notice-test' })).statusCode, 200);
  assert.equal(configurationFor(runtime).current(), afterGlobal + 3);
  assert.equal(runtime.getBindingBySessionId(a.input.sessionId).runtimeId, a.binding.runtimeId);
  assert.equal(runtime.getBindingBySessionId(b.input.sessionId).runtimeId, b.binding.runtimeId);
});
