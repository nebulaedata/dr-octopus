/**
 * @author Codex
 * @description Verifies the checked-in Agent wrapper installs before build and loads compiled code after relocation.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pnpmCommand } from '../src/process.ts';
import { copyWorkspaceRelease } from '../scripts/workspace-release.mjs';

/**
 * Runs the installed pnpm without a shell and retains both streams for warning assertions.
 */
function run(pnpm, cwd, args) {
  const result = spawnSync(pnpm.command, [...pnpm.args, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  assert.ifError(result.error);
  return result;
}

test('Agent command installs without dist or lifecycle scripts and loads the same wrapper after release copying', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus bin install '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const target = join(root, 'release');
  const agent = join(source, 'packages/agent');
  await mkdir(join(agent, 'bin'), { recursive: true });
  await mkdir(target);
  const manifest = JSON.parse(
    await readFile(new URL('../../../packages/agent/package.json', import.meta.url), 'utf8')
  );
  const config = JSON.parse(await readFile(new URL('../../../release.config.json', import.meta.url), 'utf8'));
  assert.ok(
    config.requiredFiles.some((file) => file.package === manifest.name && file.path === 'dist/bin/octopus.js')
  );
  const wrapper = await readFile(new URL('../../../packages/agent/bin/octopus.mjs', import.meta.url));
  await writeFile(join(agent, 'bin/octopus.mjs'), wrapper);
  await writeFile(
    join(agent, 'package.json'),
    JSON.stringify({ name: manifest.name, version: manifest.version, type: manifest.type, bin: manifest.bin })
  );
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({ private: true, dependencies: { [manifest.name]: 'workspace:*' } })
  );
  await writeFile(join(source, 'pnpm-workspace.yaml'), 'packages: ["packages/*"]');
  const pnpm = await pnpmCommand(process.cwd());
  const installed = run(pnpm, source, ['install', '--offline', '--ignore-scripts']);
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  assert.doesNotMatch(installed.stdout + installed.stderr, /Failed to create bin|ENOENT/);
  const unbuilt = run(pnpm, source, ['exec', 'octopus']);
  assert.equal(unbuilt.status, 1);
  assert.match(unbuilt.stderr, /Agent CLI is not built/);
  await mkdir(join(agent, 'dist/bin'), { recursive: true });
  await writeFile(join(agent, 'dist/bin/octopus.js'), 'console.log(JSON.stringify(process.argv.slice(2)));');
  await copyWorkspaceRelease(source, target, [{ path: agent }], config.artifacts);
  for (const cwd of [source, target]) {
    const installed = run(pnpm, cwd, ['install', '--offline', '--ignore-scripts', '--frozen-lockfile']);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    assert.doesNotMatch(installed.stdout + installed.stderr, /Failed to create bin|ENOENT/);
    const started = run(pnpm, cwd, ['exec', 'octopus', '--model', 'fixture model']);
    assert.equal(started.status, 0, started.stdout + started.stderr);
    assert.deepEqual(JSON.parse(started.stdout), ['--model', 'fixture model']);
  }
});
