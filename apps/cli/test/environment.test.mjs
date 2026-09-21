/**
 * @author Codex
 * @description Checks that Gateway preflight validates persisted Server settings without contaminating child environments.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { preflightGateway } from '../src/gateway.ts';

test('Gateway preflight reads Server JSON and rejects masked invalid settings without applying defaults globally', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-gateway-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = {
    SERVER_DATA_DIR: process.env.SERVER_DATA_DIR,
    SERVER_PORT: process.env.SERVER_PORT,
    SERVER_FILE_LOG_ENABLED: process.env.SERVER_FILE_LOG_ENABLED,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.SERVER_DATA_DIR = root;
  process.env.SERVER_PORT = '4500';
  delete process.env.SERVER_FILE_LOG_ENABLED;
  const path = join(root, 'environment.json');
  const devEntry = join(root, 'runtime.mjs');
  await writeFile(devEntry, 'export const createServerRuntime = () => {};');
  await writeFile(path, JSON.stringify({ SERVER_PORT: '4001', SERVER_FILE_LOG_ENABLED: 'true' }));
  await preflightGateway({ devEntry, timeout: 1000 });
  assert.equal(process.env.SERVER_PORT, '4500');
  assert.equal(process.env.SERVER_FILE_LOG_ENABLED, undefined);
  await writeFile(path, JSON.stringify({ SERVER_PORT: '99999' }));
  await assert.rejects(preflightGateway({ devEntry, timeout: 1000 }), { code: 'ENV_INVALID' });
});
