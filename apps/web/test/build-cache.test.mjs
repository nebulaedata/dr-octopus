/**
 * @author Codex
 * @description Verifies Turbo's resolved Web build cache tracks both release version inputs in an isolated workspace.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const require = createRequire(new URL('../../../package.json', import.meta.url));
const turbo = join(dirname(require.resolve('turbo/package.json')), 'bin/turbo');

/**
 * Creates only deterministic inputs inside the test-owned workspace.
 */
async function file(root, path, contents) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

/**
 * Asks the actual Turbo executable for its effective task and file hashes without building or installing.
 */
async function buildTask(root) {
  const { stdout } = await run(
    process.execPath,
    [turbo, 'run', 'build', '--filter=@octopus/web', '--dry=json'],
    { cwd: root, timeout: 30000, maxBuffer: 4 * 1024 ** 2, windowsHide: true }
  );
  return JSON.parse(stdout).tasks.find((task) => task.taskId === '@octopus/web#build');
}

test('repository and Executor version changes each invalidate the effective Web build hash', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-web-build-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await file(
    root,
    'package.json',
    JSON.stringify({ name: 'cache-test', private: true, packageManager: 'pnpm@11.18.0' })
  );
  await file(root, 'pnpm-workspace.yaml', 'packages: ["apps/*"]\n');
  await file(
    root,
    'pnpm-lock.yaml',
    'lockfileVersion: "9.0"\nimporters:\n  .: {}\n  apps/web: {}\n  apps/executor: {}\n'
  );
  await file(root, 'turbo.json', await readFile(new URL('../../../turbo.json', import.meta.url)));
  await file(
    root,
    'apps/web/package.json',
    JSON.stringify({ name: '@octopus/web', scripts: { build: 'node --version' } })
  );
  try {
    await file(root, 'apps/web/turbo.json', await readFile(new URL('../turbo.json', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  await file(root, 'release.config.json', JSON.stringify({ manifest: { version: '1.2.3' } }));
  await file(
    root,
    'apps/executor/package.json',
    JSON.stringify({ name: '@octopus/executor', version: '0.9.1' })
  );
  const first = await buildTask(root);
  assert.ok(Object.keys(first.inputs).some((path) => path.endsWith('release.config.json')));
  assert.ok(
    Object.keys(first.inputs).some((path) => path.replaceAll('\\', '/').endsWith('executor/package.json'))
  );
  await file(root, 'release.config.json', JSON.stringify({ manifest: { version: '1.2.4' } }));
  const repositoryChanged = await buildTask(root);
  assert.notEqual(repositoryChanged.hash, first.hash);
  await file(
    root,
    'apps/executor/package.json',
    JSON.stringify({ name: '@octopus/executor', version: '0.9.2' })
  );
  assert.notEqual((await buildTask(root)).hash, repositoryChanged.hash);
});
