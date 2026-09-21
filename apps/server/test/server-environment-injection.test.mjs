/**
 * @author Codex
 * @description Verifies Server entry environment injection, child inheritance and reload provenance in isolated processes.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const execute = promisify(execFile);

test(
  'Windows launch overrides survive removal of differently cased file keys',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'octopus-server-case-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const script = `
    import assert from 'node:assert/strict';
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { initializeServerEnvironment, createServerEnvironmentStore } from './dist/config.js';
    const directory = process.env.SERVER_DATA_DIR;
    delete process.env.SERVER_DATA_DIR;
    process.env.server_data_dir = directory;
    delete process.env.HTTPS_PROXY;
    process.env.https_proxy = 'http://127.0.0.1:12345';
    const path = join(directory, 'environment.json');
    writeFileSync(path, JSON.stringify({ HTTPS_PROXY: 'http://127.0.0.1:54321' }));
    initializeServerEnvironment();
    assert.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1:12345');
    assert.equal(createServerEnvironmentStore(directory).load().sources.HTTPS_PROXY, 'process');
    writeFileSync(path, '{}');
    initializeServerEnvironment();
    assert.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1:12345');
    assert.equal(process.env.SERVER_DATA_DIR, directory);
  `;
    await execute(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, SERVER_DATA_DIR: directory },
    });
  }
);

test('Server file values reach process and children while launch overrides and reload sources remain correct', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-server-injection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { ...process.env, SERVER_DATA_DIR: directory, SERVER_PORT: '4300' };
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
  }
  const script = `
    import assert from 'node:assert/strict';
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { execFileSync } from 'node:child_process';
    import { initializeServerEnvironment, createServerEnvironmentStore } from './dist/config.js';
    import { EnvironmentSettingsService } from './dist/modules/settings/environment-settings.service.js';
    const path = join(process.env.SERVER_DATA_DIR, 'environment.json');
    const save = (value) => writeFileSync(path, JSON.stringify(value));
    save({ SERVER_PORT: '4400', HTTPS_PROXY: 'http://user:secret@127.0.0.1:7890' });
    initializeServerEnvironment();
    assert.equal(process.env.SERVER_PORT, '4300');
    assert.equal(process.env.HTTPS_PROXY, 'http://user:secret@127.0.0.1:7890');
    assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write(process.env.HTTPS_PROXY)'], { encoding: 'utf8' }), process.env.HTTPS_PROXY);
    const store = createServerEnvironmentStore(process.env.SERVER_DATA_DIR);
    assert.equal(store.load().sources.HTTPS_PROXY, 'file');
    const service = new EnvironmentSettingsService(process.env.SERVER_DATA_DIR, process.env.SERVER_DATA_DIR);
    assert.doesNotMatch(JSON.stringify(service.get('server')), /user:secret/);
    const updated = await service.update('server', { revision: service.get('server').revision, changes: { HTTPS_PROXY: 'http://127.0.0.1:7900' } });
    assert.equal(updated.entries.find((item) => item.key === 'HTTPS_PROXY').source, 'file');
    assert.equal(process.env.HTTPS_PROXY, 'http://user:secret@127.0.0.1:7890');
    initializeServerEnvironment();
    assert.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1:7900');
    save({ SERVER_PORT: '4500' });
    initializeServerEnvironment();
    assert.equal(process.env.HTTPS_PROXY, undefined);
    assert.equal(process.env.SERVER_PORT, '4300');
    save({ HTTPS_PROXY: 'http://127.0.0.1:7999', SERVER_PORT: '99999' });
    assert.throws(() => initializeServerEnvironment());
    assert.equal(process.env.HTTPS_PROXY, undefined);
    console.log('verified');
  `;
  const result = await execute(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    env,
  });
  assert.equal(result.stdout.trim(), 'verified');
});
