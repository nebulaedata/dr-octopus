/**
 * @author Codex
 * @description Verifies CLI behavior without runtime dependencies and protects file-log option precedence.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileLogValue } from '../src/gateway.ts';

const exec = promisify(execFile);

test('File log precedence distinguishes explicit disable from inherited environment and restart', () => {
  assert.equal(fileLogValue(false, { SERVER_FILE_LOG_ENABLED: 'true' }, true), 'false');
  assert.equal(fileLogValue(true, { SERVER_FILE_LOG_ENABLED: 'false' }, false), 'true');
  assert.equal(fileLogValue(undefined, { SERVER_FILE_LOG_ENABLED: 'false' }, true), 'false');
  assert.equal(fileLogValue(undefined, {}, true), 'true');
  assert.equal(fileLogValue(undefined, {}), 'false');
});

test('Root bin runs bundled help, JSON errors and read-only status without node_modules', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus cli commands '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = JSON.parse(await readFile(new URL('../../../release.config.json', import.meta.url), 'utf8'));
  const entry = join(root, config.bootstrap.destination);
  await mkdir(dirname(entry), { recursive: true });
  await copyFile(new URL('../dist/cli.mjs', import.meta.url), entry);
  const help = await exec(process.execPath, [entry, '--help'], { cwd: root });
  assert.match(help.stdout, /gateway/);
  assert.match(help.stdout, /tui/);
  const tuiHelp = await exec(process.execPath, [entry, 'tui', '--help'], { cwd: root });
  assert.match(tuiHelp.stdout, /Arguments forwarded to octopus/);
  assert.equal(tuiHelp.stderr, '');
  assert.match(help.stdout, /Usage: dr-octopus /);
  const defaultHelp = await exec(process.execPath, [entry], { cwd: root });
  assert.equal(defaultHelp.stdout, help.stdout);
  assert.equal(defaultHelp.stderr, '');
  for (const args of [['unknown-command'], ['gateway']]) {
    await assert.rejects(exec(process.execPath, [entry, ...args], { cwd: root }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /commander\./);
      return true;
    });
  }
  const status = await exec(process.execPath, [entry, 'gateway', 'status', '--json'], { cwd: root });
  assert.equal(JSON.parse(status.stdout).service, 'gateway');
  for (const args of [
    ['migrate', '--json'],
    ['gateway', 'start', '--file-log', '--no-file-log', '--json'],
    ['gateway', 'start', '--no-file-log', '--file-log', '--json'],
  ]) {
    await assert.rejects(exec(process.execPath, [entry, ...args], { cwd: root }), (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.match(result.error.code, args[0] === 'migrate' ? /NOT_IMPLEMENTED/ : /CONFLICTING_OPTIONS/);
      return true;
    });
  }
});
