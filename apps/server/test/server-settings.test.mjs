/**
 * @author Codex
 * @description Tests shared Server writes, exposure confirmation, old-value repair and safe field projections.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ServerConfiguration } from '../dist/modules/settings/server-configuration.js';
import { ServerSettingsService } from '../dist/modules/settings/server-settings.service.js';
import { registerServerSettingsController } from '../dist/modules/settings/server-settings.controller.js';
import { ConfigurationQueue } from '../dist/lib/lifecycle/control.js';
import { loadServerConfig } from '../dist/lib/config/config.js';
import { isAllowedOrigin } from '../dist/modules/channel/channel.utils.js';

test('both editors share confirmation, conflict checks and unchanged storage', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-server-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = new ServerConfiguration(root, undefined, {});
  const before = settings.get();
  const patch = { revision: before.revision, changes: { SERVER_HOST: '0.0.0.0' } };
  await assert.rejects(settings.update(patch), { code: 'SERVER_EXPOSURE_CONFIRMATION_REQUIRED' });
  assert.equal(settings.get().revision, before.revision);
  const saved = await settings.update(patch, true);
  assert.equal(saved.persisted.SERVER_HOST, '0.0.0.0');
  await assert.rejects(settings.update(patch, true), { code: 'ENV_CONFLICT' });
  assert.equal((await settings.update({ ...patch, revision: saved.revision })).revision, saved.revision);
  await writeFile(
    join(root, 'environment.json'),
    JSON.stringify({ SERVER_CORS_ORIGIN: 'https://example.com/business' })
  );
  const invalid = settings.get();
  assert.equal(invalid.persisted.SERVER_CORS_ORIGIN, 'https://example.com/business');
  await assert.rejects(settings.update({ revision: invalid.revision, changes: { SERVER_PORT: '3100' } }), {
    code: 'ENV_INVALID',
  });
  const repaired = await settings.update({
    revision: invalid.revision,
    changes: { SERVER_CORS_ORIGIN: 'https://example.com' },
  });
  assert.equal(repaired.persisted.SERVER_CORS_ORIGIN, 'https://example.com');
});
test('safe projection distinguishes current inherited log level from next and validates routes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-server-projection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { SERVER_DATA_DIR: root, UNRELATED_SECRET: 'not-public' };
  const config = loadServerConfig(env);
  const control = {
    instanceId: randomUUID(),
    queue: new ConfigurationQueue(),
    assertOpen() {},
    state: () => 'running',
    currentEnvironment: { values: { ...env, LOG_LEVEL: 'info' } },
  };
  const configuration = new ServerConfiguration(root, control, env);
  const service = new ServerSettingsService(config, configuration, control, () => ({
    state: 'running',
    address: null,
    activeRuntimeCount: 0,
    fileLogging: { enabled: false, state: 'disabled', directory: root },
  }));
  await configuration.update({ revision: configuration.get().revision, changes: { LOG_LEVEL: 'debug' } });
  const dto = service.get();
  assert.equal(dto.fields.SERVER_FILE_LOG_LEVEL.current.value, 'info');
  assert.equal(dto.fields.SERVER_FILE_LOG_LEVEL.next.value, 'debug');
  assert.ok(dto.pendingRestartFields.includes('SERVER_FILE_LOG_LEVEL'));
  assert.equal(dto.additionalPendingRestart, true);
  assert.doesNotMatch(JSON.stringify(dto), /not-public|UNRELATED_SECRET/);
  const app = Fastify();
  t.after(() => app.close());
  registerServerSettingsController(app, service, control);
  const response = await app.inject('/settings/server');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const bad = await app.inject({
    method: 'PATCH',
    url: '/settings/server',
    payload: { revision: dto.revision, changes: { LOG_LEVEL: 'trace' } },
  });
  assert.equal(bad.statusCode, 400);
});
test('Origin rules allow exact LAN same-origin and reject a different browser origin', () => {
  assert.equal(
    isAllowedOrigin('http://192.168.1.2:3000', [], {
      headers: { host: '192.168.1.2:3000' },
      protocol: 'http',
    }),
    true
  );
  assert.equal(
    isAllowedOrigin('http://192.168.1.3:3000', [], {
      headers: { host: '192.168.1.2:3000' },
      protocol: 'http',
    }),
    false
  );
  assert.equal(isAllowedOrigin(undefined, []), true);
  assert.equal(isAllowedOrigin('https://public.example', ['https://public.example']), true);
});

test('Host validation rejects rebinding with and without Origin while retaining explicit domains', () => {
  const request = { headers: { host: 'attacker.example:3000' }, protocol: 'http' };
  for (const origin of [undefined, 'http://attacker.example:3000', 'https://trusted.example']) {
    assert.equal(isAllowedOrigin(origin, ['https://trusted.example'], request), false);
  }
  assert.equal(
    isAllowedOrigin('http://attacker.example:3000', () => false, request),
    false
  );
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.1.2:3000']) {
    assert.equal(isAllowedOrigin(`http://${host}`, [], { headers: { host } }), true);
    assert.equal(isAllowedOrigin(undefined, [], { headers: { host } }), true);
  }
  const proxy = { headers: { host: 'trusted.example' }, protocol: 'http' };
  assert.equal(isAllowedOrigin('https://trusted.example', ['https://trusted.example'], proxy), true);
  assert.equal(isAllowedOrigin(undefined, ['https://trusted.example'], proxy), true);
});
