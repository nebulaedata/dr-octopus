/**
 * @author Codex
 * @description Exercises the installer pipeline in an isolated repository with child-process failures and paths containing spaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * Runs the real entrypoint with an inert pnpm executable; no product resources, network or native compiler are used.
 */
async function pipeline({ prepared = false, fail = '', args = [] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus installer '));
  try {
    const executor = join(directory, 'apps/executor');
    await mkdir(join(executor, 'scripts/package'), { recursive: true });
    await mkdir(join(executor, 'scripts/lib'), { recursive: true });
    await copyFile(
      new URL('../scripts/package/build-installer.mjs', import.meta.url),
      join(executor, 'scripts/package/build-installer.mjs')
    );
    await copyFile(
      new URL('../scripts/lib/platform.mjs', import.meta.url),
      join(executor, 'scripts/lib/platform.mjs')
    );
    if (prepared) {
      for (const resource of ['node', 'search', 'computer']) {
        await mkdir(join(executor, 'dist/resources', resource), { recursive: true });
      }
      await mkdir(join(executor, 'build'));
      await writeFile(join(executor, 'build/packaging-tools.json'), '{}');
    }
    const log = join(directory, 'calls.jsonl');
    const cli = join(directory, 'fake pnpm.mjs');
    await writeFile(
      cli,
      `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.INSTALLER_TEST_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
if (process.env.INSTALLER_TEST_FAIL && args.includes(process.env.INSTALLER_TEST_FAIL)) process.exit(7);
`
    );
    let error;
    try {
      await promisify(execFile)(
        process.execPath,
        [join(executor, 'scripts/package/build-installer.mjs'), ...args],
        {
          cwd: tmpdir(),
          windowsHide: true,
          env: {
            ...process.env,
            npm_execpath: cli,
            EXECUTOR_NODE_HEADERS: join(directory, 'fixed headers'),
            INSTALLER_TEST_LOG: log,
            INSTALLER_TEST_FAIL: fail,
          },
        }
      );
    } catch (failure) {
      error = failure;
    }
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.every((call) => call.cwd.toLowerCase() === directory.toLowerCase()));
    return { calls: calls.map((call) => call.args), error };
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  'installer prepares absent resources and preserves an output path with spaces',
  { skip: process.platform !== 'win32' },
  async () => {
    const output = 'D:/build outputs/验收';
    const { calls, error } = await pipeline({ args: ['--output-root', output] });
    assert.equal(error, undefined);
    assert.deepEqual(calls, [
      ['exec', 'turbo', 'run', 'build', '--filter=@octopus/browser-extension'],
      ['--filter', '@octopus/executor', 'assemble:node'],
      ['--filter', '@octopus/executor', 'assemble:search'],
      ['--filter', '@octopus/executor', 'assemble:computer'],
      ['exec', 'turbo', 'run', 'build', '--filter=@octopus/executor'],
      ['--filter', '@octopus/executor', 'assemble:packaging'],
      ['--filter', '@octopus/executor', 'package:acceptance', '--output-root', output],
    ]);
  }
);

test(
  'installer reuses prepared resources and still builds before packaging',
  { skip: process.platform !== 'win32' },
  async () => {
    const { calls, error } = await pipeline({ prepared: true });
    assert.equal(error, undefined);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((args) => !args.some((arg) => arg.startsWith('assemble:'))));
    assert.equal(calls.at(-1).at(-1), 'package:acceptance');
  }
);

test(
  'installer stops before packaging when either build fails',
  { skip: process.platform !== 'win32' },
  async () => {
    for (const [fail, count] of [
      ['--filter=@octopus/browser-extension', 1],
      ['--filter=@octopus/executor', 2],
    ]) {
      const { calls, error } = await pipeline({ prepared: true, fail });
      assert.ok(error);
      assert.equal(calls.length, count);
      assert.ok(calls.every((args) => !args.includes('package:acceptance')));
    }
  }
);
