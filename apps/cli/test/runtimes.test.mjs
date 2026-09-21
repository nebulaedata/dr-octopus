/**
 * @author Codex
 * @description Verifies runtime pruning boundaries, previews and active-process protection in isolated directories.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { distribution } from '../src/distribution/location.ts';
import { acquireInstallLock } from '../src/distribution/install-lock.ts';
import { referencesRuntime } from '../src/distribution/runtime-processes.ts';
import { listRuntimes, pruneRuntimes } from '../src/runtimes.ts';

test('bare runtimes command prints help successfully while invalid subcommands fail', () => {
  const entry = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
  for (const args of [['runtimes'], ['runtimes', '--help']]) {
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: .* runtimes/);
    assert.match(result.stdout, /prune/);
    assert.equal(result.stderr, '');
  }
  const invalid = spawnSync(process.execPath, [entry, 'runtimes', 'invalid'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
});

/**
 * Creates marked runtime fixtures without using the user's home directory.
 */
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'octopus-prune-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const context = {
    root: home,
    packaged: true,
    layout: { ...distribution().layout, sha256: 'a'.repeat(64), archive: 'payload.tar.gz' },
  };
  const root = join(home, context.layout.runtimeDirectory);
  /**
   * Writes deterministic runtime identification and a process fixture.
   */
  async function runtime(digit) {
    const path = join(
      root,
      `${digit.repeat(24)}-${process.platform}-${process.arch}-${process.versions.modules}`
    );
    await mkdir(path, { recursive: true });
    await writeFile(join(path, '.payload-sha256'), digit.repeat(64));
    await writeFile(join(path, 'release-layout.json'), JSON.stringify(distribution().layout));
    await writeFile(join(path, 'worker.mjs'), "console.log('ready'); setInterval(() => {}, 1000);");
    return path;
  }
  return { home, context, root, current: await runtime('a'), old: await runtime('b') };
}

test('preview makes no writes; prune preserves current, unknown and linked directories', async (t) => {
  const f = await fixture(t);
  const unrelated = join(f.home, 'user-data');
  await mkdir(unrelated);
  await writeFile(join(unrelated, 'keep'), 'user data');
  await mkdir(join(f.root, 'unknown'));
  await symlink(unrelated, join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const before = await readdir(f.root);
  const preview = await pruneRuntimes({ dryRun: true }, f.context, f.home);
  const candidate = preview.runtimes.find((entry) => entry.directory === f.old);
  assert.equal(candidate.status, 'would-remove', candidate.reason);
  assert.ok(preview.reclaimedBytes > 0);
  assert.deepEqual(await readdir(f.root), before);
  const result = await pruneRuntimes({}, f.context, f.home);
  assert.equal(result.runtimes.find((entry) => entry.directory === f.old).status, 'removed');
  assert.equal(result.runtimes.find((entry) => entry.directory === f.current).status, 'current');
  assert.equal(await readFile(join(unrelated, 'keep'), 'utf8'), 'user data');
  assert.ok((await readdir(f.root)).includes('unknown'));
  assert.ok((await readdir(f.root)).includes('linked'));
  assert.equal(
    (await listRuntimes(f.context, f.home)).runtimes.some((entry) => entry.directory === f.old),
    false
  );
});

test('active installers and malformed locks are retained', async (t) => {
  const f = await fixture(t);
  const unlock = await acquireInstallLock(f.old);
  try {
    const result = await pruneRuntimes({}, f.context, f.home);
    assert.equal(result.runtimes.find((entry) => entry.directory === f.old).status, 'in-use');
  } finally {
    await unlock();
  }
  await writeFile(f.old + '.install.lock', 'invalid');
  const result = await pruneRuntimes({}, f.context, f.home);
  assert.equal(result.runtimes.find((entry) => entry.directory === f.old).status, 'unverified');
});

test('a live Node process using an old runtime prevents deletion', async (t) => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [join(f.old, 'worker.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    await once(child.stdout, 'data');
    const result = await pruneRuntimes({}, f.context, f.home);
    assert.equal(result.runtimes.find((entry) => entry.directory === f.old).status, 'in-use');
  } finally {
    const closed = once(child, 'close');
    child.kill();
    await closed;
  }
});

test('payload mismatch and redirected root are never deleted', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.old, '.payload-sha256'), 'c'.repeat(64));
  const result = await pruneRuntimes({}, f.context, f.home);
  assert.equal(result.runtimes.find((entry) => entry.directory === f.old).status, 'unverified');
  await symlink(f.root, join(f.home, 'redirected'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    listRuntimes({ ...f.context, layout: { ...f.context.layout, runtimeDirectory: 'redirected' } }, f.home),
    /redirected/
  );
});

test('missing cache is empty', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    (
      await listRuntimes(
        { ...f.context, layout: { ...f.context.layout, runtimeDirectory: 'missing' } },
        f.home
      )
    ).runtimes,
    []
  );
});

test('development prune previews and removes idle runtimes while retaining active ones and workspace files', async (t) => {
  const f = await fixture(t);
  const context = { ...f.context, packaged: false };
  const source = join(f.home, 'workspace-source.ts');
  await writeFile(source, 'keep workspace');
  const unlock = await acquireInstallLock(f.current);
  try {
    const preview = await pruneRuntimes({ dryRun: true }, context, f.home);
    assert.equal(preview.runtimes.find((entry) => entry.directory === f.old).status, 'would-remove');
    assert.ok(preview.runtimes.every((entry) => !entry.current));
    assert.equal(await readFile(join(f.old, '.payload-sha256'), 'utf8'), 'b'.repeat(64));
    const result = await pruneRuntimes({}, context, f.home);
    assert.equal(result.runtimes.find((entry) => entry.directory === f.old).status, 'removed');
    assert.equal(result.runtimes.find((entry) => entry.directory === f.current).status, 'in-use');
    assert.equal(await readFile(source, 'utf8'), 'keep workspace');
  } finally {
    await unlock();
  }
});

test('process matching rejects names with a shared prefix', () => {
  assert.equal(referencesRuntime('node /cache/abc/main.mjs', '/cache/abc'), true);
  assert.equal(referencesRuntime('node /cache/abcd/main.mjs', '/cache/abc'), false);
});

test('unverifiable knowledge use locks are retained without loading old runtime code', async (t) => {
  const f = await fixture(t);
  await writeFile(f.old + '.knowledge-use.lock', '');
  const result = await pruneRuntimes({}, f.context, f.home);
  assert.equal(result.runtimes.find((entry) => entry.directory === f.old).status, 'unverified');
  assert.ok(await readFile(join(f.old, '.payload-sha256'), 'utf8'));
});
