/**
 * @author Codex
 * @description Verifies Agent bootstrap configuration in isolated processes without initializing Pi or model calls.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentEnvironmentStore } from '../dist/utils/environment.js';

test('Agent bootstrap loads its own JSON before consumers run and preserves explicit environment overrides', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-agent-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'environment.json'),
    JSON.stringify({ PI_OFFLINE: '0', EXAMPLE_CREDENTIAL: 'fixture-value' })
  );
  const module = new URL('../dist/utils/environment.js', import.meta.url).href;
  const source = `const {initializeAgentEnvironment}=await import(${JSON.stringify(module)});initializeAgentEnvironment();console.log(JSON.stringify({offline:process.env.PI_OFFLINE,key:process.env.EXAMPLE_CREDENTIAL}));`;
  const env = { ...process.env, DR_OCTOPUS_CODING_AGENT_DIR: root };
  delete env.PI_OFFLINE;
  delete env.EXAMPLE_CREDENTIAL;
  const exec = promisify(execFile);
  assert.deepEqual(
    JSON.parse((await exec(process.execPath, ['--input-type=module', '--eval', source], { env })).stdout),
    { offline: '0', key: 'fixture-value' }
  );
  assert.deepEqual(
    JSON.parse(
      (
        await exec(process.execPath, ['--input-type=module', '--eval', source], {
          env: { ...env, PI_OFFLINE: '1' },
        })
      ).stdout
    ),
    { offline: '1', key: 'fixture-value' }
  );
  assert.throws(() => createAgentEnvironmentStore('relative', {}).load(), { code: 'ENV_INVALID' });
});

test('Agent startup defaults online and honors persisted, environment and CLI offline requests', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-agent-online-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environmentModule = new URL('../dist/utils/environment.js', import.meta.url).href;
  const prepareModule = new URL('../dist/cli/prepare-env.js', import.meta.url).href;
  const argsModule = new URL('../dist/cli/parse-args.js', import.meta.url).href;
  const source = `
    const { initializeAgentEnvironment } = await import(${JSON.stringify(environmentModule)});
    const { prepareOfflineEnv } = await import(${JSON.stringify(prepareModule)});
    const { isOfflineRequested } = await import(${JSON.stringify(argsModule)});
    initializeAgentEnvironment();
    const before = isOfflineRequested([]);
    prepareOfflineEnv();
    console.log(JSON.stringify({ before, after: isOfflineRequested([]), flag: isOfflineRequested(['--offline']) }));
  `;
  const env = { ...process.env, DR_OCTOPUS_CODING_AGENT_DIR: root };
  delete env.PI_OFFLINE;
  const exec = promisify(execFile);
  assert.deepEqual(
    JSON.parse((await exec(process.execPath, ['--input-type=module', '--eval', source], { env })).stdout),
    { before: false, after: false, flag: true }
  );
  await writeFile(join(root, 'environment.json'), JSON.stringify({ PI_OFFLINE: '1' }));
  assert.deepEqual(
    JSON.parse((await exec(process.execPath, ['--input-type=module', '--eval', source], { env })).stdout),
    { before: true, after: true, flag: true }
  );
  assert.deepEqual(
    JSON.parse(
      (
        await exec(process.execPath, ['--input-type=module', '--eval', source], {
          env: { ...env, PI_OFFLINE: '0' },
        })
      ).stdout
    ),
    { before: false, after: false, flag: true }
  );
  const fallbackSource = `
    const { prepareOfflineEnv } = await import(${JSON.stringify(prepareModule)});
    prepareOfflineEnv();
    console.log(process.env.PI_OFFLINE);
  `;
  assert.equal(
    (await exec(process.execPath, ['--input-type=module', '--eval', fallbackSource], { env })).stdout.trim(),
    '0'
  );
});
