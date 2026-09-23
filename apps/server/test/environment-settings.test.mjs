/**
 * @author Codex
 * @description Verifies scoped Settings persistence, redaction, override attribution, and restart-time configuration loading.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import test from 'node:test';
import { EnvironmentSettingsService } from '../dist/modules/environment-settings/environment-settings.service.js';
import { registerEnvironmentSettingsController } from '../dist/modules/environment-settings/environment-settings.controller.js';

test('environment Settings supports independent scopes, stale edit rejection and secret-preserving patches', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-env-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const serverDir = join(root, 'server');
  const agentDir = join(root, 'elsewhere', 'agent');
  const service = new EnvironmentSettingsService(serverDir, agentDir, {
    SERVER_PORT: '4000',
    UNRELATED_SECRET: 'never-enumerate',
  });
  const app = Fastify();
  t.after(() => app.close());
  registerEnvironmentSettingsController(app, service);
  const before = (await app.inject('/settings/environment/server')).json();
  const response = await app.inject({
    method: 'PATCH',
    url: '/settings/environment/server',
    payload: { revision: before.revision, changes: { SERVER_PORT: '4001' } },
  });
  assert.equal(response.statusCode, 200);
  const port = response.json().entries.find((entry) => entry.key === 'SERVER_PORT');
  assert.equal(port.storedValue, '4001');
  assert.equal(port.resolvedValue, '4000');
  assert.equal(port.source, 'process');
  assert.doesNotMatch(response.body, /UNRELATED_SECRET|never-enumerate/);
  const stale = await app.inject({
    method: 'PATCH',
    url: '/settings/environment/server',
    payload: { revision: before.revision, changes: { SERVER_PORT: '4002' } },
  });
  assert.equal(stale.statusCode, 409);
  const agent = service.get('agent');
  const updated = await service.update('agent', {
    revision: agent.revision,
    changes: { DEMO_API_KEY: 'test-secret-value', CUSTOM: 'private-custom' },
  });
  assert.doesNotMatch(JSON.stringify(updated), /test-secret-value|private-custom/);
  assert.equal(updated.entries.find((entry) => entry.key === 'DEMO_API_KEY').hasStoredValue, true);
  const deleted = await service.update('agent', { revision: updated.revision, changes: { CUSTOM: null } });
  assert.equal(
    deleted.entries.some((entry) => entry.key === 'CUSTOM'),
    false
  );
  assert.equal(
    JSON.parse(await readFile(join(agentDir, 'environment.json'), 'utf8')).DEMO_API_KEY,
    'test-secret-value'
  );
  await assert.rejects(
    service.update('server', { revision: response.json().revision, changes: { SERVER_DATA_DIR: root } }),
    { code: 'ENV_INVALID' }
  );
  await assert.rejects(
    service.update('server', { revision: response.json().revision, changes: { SERVER_PORT: '99999' } }),
    { code: 'ENV_INVALID' }
  );
  await assert.rejects(
    service.update('agent', { revision: deleted.revision, changes: { DR_OCTOPUS_CODING_AGENT_DIR: root } }),
    { code: 'ENV_INVALID' }
  );
  assert.equal((await app.inject('/settings/environment/unknown')).statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/settings/environment/agent',
        payload: { revision: deleted.revision, changes: { PORT: 3000 } },
      })
    ).statusCode,
    400
  );

  const env = { ...process.env, SERVER_DATA_DIR: serverDir, DR_OCTOPUS_CODING_AGENT_DIR: agentDir };
  delete env.SERVER_PORT;
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const {loadServerConfig}=await import('./dist/infrastructure/config/config.js');const config=loadServerConfig();console.log(JSON.stringify({port:config.port,polluted:process.env.SERVER_PORT}));",
    ],
    { cwd, env }
  );
  assert.deepEqual(JSON.parse(result.stdout), { port: 4001 });
});
