/**
 * @author Codex
 * @description Verifies the install-time CLI entry before and after building without loading Agent services.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';

/**
 * Copies the declared package entry into an isolated package without build output.
 */
async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-bin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const entry = join(root, manifest.bin.octopus);
  await mkdir(join(root, 'bin'), { recursive: true });
  await copyFile(new URL(`../${manifest.bin.octopus}`, import.meta.url), entry);
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  return { root, entry };
}

test('declared CLI entry exists before build and explains how to build', async (t) => {
  const { entry } = await createFixture(t);
  const result = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm exec turbo run build --filter=@octopus\/agent/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
});

test('CLI entry preserves arguments and exit status from the built CLI', async (t) => {
  const { root, entry } = await createFixture(t);
  await mkdir(join(root, 'dist', 'bin'), { recursive: true });
  await writeFile(
    join(root, 'dist', 'bin', 'octopus.js'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;'
  );
  const result = spawnSync(process.execPath, [entry, 'hello', 'two words'], { encoding: 'utf8' });
  assert.equal(result.status, 7);
  assert.deepEqual(JSON.parse(result.stdout), ['hello', 'two words']);
});
