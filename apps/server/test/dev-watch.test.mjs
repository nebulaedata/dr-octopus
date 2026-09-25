/**
 * @author Codex
 * @description Verifies shared protocol rebuilds replace the development Server's loaded schema.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

/**
 * Waits for an observable child startup without relying on filesystem notification timing.
 */
async function waitFor(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  assert.fail('Development watcher did not reach the expected state');
}

test(
  'shared JavaScript changes restart the Server, identical rewrites do not',
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-dev-watch-'));
    const server = join(root, 'apps/server');
    const shared = join(root, 'packages/shared/dist');
    await mkdir(join(server, 'scripts'), { recursive: true });
    await mkdir(join(server, 'src'), { recursive: true });
    await mkdir(shared, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await symlink(
      resolve('node_modules'),
      join(server, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await copyFile('scripts/dev-watch.mjs', join(server, 'scripts/dev-watch.mjs'));
    const schemaPath = join(shared, 'schema.js');
    await writeFile(schemaPath, 'export const value = "chat";');
    const sourcePath = join(server, 'src/index.ts');
    const logPath = join(server, 'starts.log');
    await writeFile(
      sourcePath,
      `
import { appendFileSync } from 'node:fs';
import { value } from '../../../packages/shared/dist/schema.js';
appendFileSync('starts.log', value + '\\n');
process.on('message', () => process.exit(0));
setInterval(() => {}, 1000);
`
    );
    const watcher = spawn(process.execPath, ['scripts/dev-watch.mjs'], {
      cwd: server,
      stdio: 'pipe',
      windowsHide: true,
    });
    let diagnostics = '';
    watcher.stderr.on('data', (chunk) => {
      diagnostics += chunk;
    });
    t.after(async () => {
      if (watcher.exitCode === null) {
        const exited = once(watcher, 'exit');
        await writeFile(sourcePath, 'process.exit(0);');
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    });
    /**
     * Reads fixture startup receipts while the first child is still starting.
     */
    async function starts() {
      return readFile(logPath, 'utf8').catch(() => '');
    }
    await waitFor(async () => (await starts()) === 'chat\n');
    await writeFile(schemaPath, 'export const value = "other";');
    await waitFor(async () => (await starts()) === 'chat\nother\n');
    await writeFile(schemaPath, 'export const value = "other";');
    await delay(400);
    assert.equal(await starts(), 'chat\nother\n', diagnostics);
  }
);
