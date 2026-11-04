/**
 * @author Codex
 * @description Exercises publication, crash recovery, ownership and conflict decisions against isolated bundles and a controlled registry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { hostBundlePaths } from '../src/contracts/browser-host-bundle.ts';
import { BrowserHostMaintenance, browserDigest } from '../src/maintenance/browser-host.ts';

/**
 * Creates only synthetic bytes and an in-memory registry; no browser or daily registration is touched.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-host-maintenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const project = join(root, 'project');
  await mkdir(project);
  const records = ['chrome', 'edge'].flatMap((browser) =>
    ['CurrentUser', 'LocalMachine'].flatMap((hive) =>
      ['Registry32', 'Registry64'].map((view) => ({ browser, hive, view, path: null, blocked: false }))
    )
  );
  let failWrite = false;
  const registry = {
    inspect: async () => structuredClone(records),
    set: async (_name, record, path) => {
      if (failWrite && record.browser === 'edge') {
        throw new Error('EDGE_WRITE_DENIED');
      }
      Object.assign(
        records.find(
          (item) => item.browser === record.browser && item.hive === record.hive && item.view === record.view
        ),
        { path }
      );
    },
    remove: async (_name, record, path) => {
      const target = records.find(
        (item) => item.browser === record.browser && item.hive === record.hive && item.view === record.view
      );
      if (target.path === path) {
        target.path = null;
      }
    },
  };
  /**
   * Rebuilds complete test bytes with a changed public bundle identity.
   */
  async function build(version = '1.0.0', content = version, directory = source) {
    const files = {};
    for (const path of hostBundlePaths) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content + path);
      files[path] = createHash('sha256')
        .update(content + path)
        .digest('hex');
    }
    await writeFile(
      join(directory, 'host-bundle.json'),
      JSON.stringify({
        version,
        protocolVersion: 5,
        hostName: 'com.octopus.executor.browser',
        origins: [`chrome-extension://${'a'.repeat(32)}/`],
        files,
      })
    );
  }
  await build();
  const failedBuilds = new Set();
  const probe = async (_directory, bundleId) => ({
    state: failedBuilds.has(bundleId) ? 'failed' : 'ready',
    exitCode: failedBuilds.has(bundleId) ? 1 : 0,
  });
  const service = new BrowserHostMaintenance(source, project, registry, probe);
  return {
    root,
    source,
    project,
    records,
    registry,
    service,
    probe,
    failedBuilds,
    build,
    failEdge: (value) => {
      failWrite = value;
    },
  };
}

test('fresh and portable startup publishes a complete stable Host and repeated repair is idempotent', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.inspect()).phase, 'repairable');
  assert.equal((await f.service.repair()).phase, 'ready');
  const first = await readFile(join(f.project, 'browser-host/state/owner.json'), 'utf8');
  assert.equal((await f.service.repair()).phase, 'ready');
  assert.equal(await readFile(join(f.project, 'browser-host/state/owner.json'), 'utf8'), first);
  assert(
    f.records
      .filter((item) => item.hive === 'CurrentUser')
      .every((item) => item.path === join(f.project, 'browser-host/registration/native-host.json'))
  );
  assert(f.records.filter((item) => item.hive === 'LocalMachine').every((item) => item.path === null));
});

test('repair detects deployed damage and publishes another directory without overwriting loaded bytes', async (t) => {
  const f = await fixture(t);
  await f.service.repair();
  const old = JSON.parse(
    await readFile(join(f.project, 'browser-host/registration/native-host.json'), 'utf8')
  );
  await unlink(old.path);
  assert.equal((await f.service.inspect()).phase, 'repairable');
  assert.equal((await f.service.repair()).phase, 'ready');
  const next = JSON.parse(
    await readFile(join(f.project, 'browser-host/registration/native-host.json'), 'utf8')
  );
  assert.notEqual(next.path, old.path);
});

test('missing foreign manifest requires exact revision confirmation and preserves registry backup', async (t) => {
  const f = await fixture(t);
  f.records[0].path = join(f.root, 'deleted-install/native-host.json');
  const before = await f.service.inspect();
  assert.equal(before.phase, 'confirmationRequired');
  await assert.rejects(f.service.repair(), /HOST_CONFIRMATION_REQUIRED/);
  f.records[0].path += '.changed';
  await assert.rejects(
    f.service.repair({ revision: before.revision, confirmReplacement: true }),
    /HOST_DIAGNOSTICS_CHANGED/
  );
  const current = await f.service.inspect();
  assert.equal(
    (await f.service.repair({ revision: current.revision, confirmReplacement: true })).phase,
    'ready'
  );
  const backup = JSON.parse(
    await readFile(join(f.project, 'browser-host/state/last-transaction.json'), 'utf8')
  );
  assert(backup.before[0].path.endsWith('.changed'));
});

test('a second-browser write failure keeps a recoverable journal and never reports ready', async (t) => {
  const f = await fixture(t);
  f.failEdge(true);
  await assert.rejects(f.service.repair(), /EDGE_WRITE_DENIED/);
  assert.equal((await f.service.inspect()).phase, 'repairable');
  assert(JSON.parse(await readFile(join(f.project, 'browser-host/state/transaction.json'), 'utf8')).target);
  f.failEdge(false);
  assert.equal((await f.service.repair()).phase, 'ready');
});

test('newer portable installation takes ownership; old process and uninstaller cannot take it back', async (t) => {
  const f = await fixture(t);
  await f.service.repair();
  const nextRoot = join(f.root, 'next');
  await f.build('1.1.0', 'new', nextRoot);
  const next = new BrowserHostMaintenance(nextRoot, f.project, f.registry, f.probe);
  assert.equal((await next.repair()).phase, 'ready');
  await assert.rejects(f.service.repair(), /HOST_CONFIRMATION_REQUIRED/);
  await f.service.remove();
  assert.equal((await next.inspect()).phase, 'ready');
});

test('same-version different bytes require confirmation; policy and incomplete sources cannot be forced', async (t) => {
  const f = await fixture(t);
  await f.service.repair();
  await f.build('1.0.0', 'changed');
  await assert.rejects(f.service.repair(), /HOST_CONFIRMATION_REQUIRED/);
  f.records[0].blocked = true;
  let status = await f.service.inspect();
  await assert.rejects(
    f.service.repair({ revision: status.revision, confirmReplacement: true }),
    /HOST_REPAIR_BLOCKED/
  );
  f.records[0].blocked = false;
  await unlink(join(f.source, hostBundlePaths[0]));
  status = await f.service.inspect();
  assert.equal(status.phase, 'blocked');
});

test('an old process completing a newer abandoned journal cannot subsequently publish its old bundle', async (t) => {
  const f = await fixture(t);
  await f.service.repair();
  const nextRoot = join(f.root, 'next');
  await f.build('2.0.0', 'newer', nextRoot);
  const next = new BrowserHostMaintenance(nextRoot, f.project, f.registry, f.probe);
  f.failEdge(true);
  await assert.rejects(next.repair(), /EDGE_WRITE_DENIED/);
  f.failEdge(false);
  await assert.rejects(f.service.repair(), /HOST_DIAGNOSTICS_CHANGED/);
  assert.equal((await next.inspect()).phase, 'ready');
  const owner = JSON.parse(await readFile(join(f.project, 'browser-host/state/owner.json'), 'utf8'));
  assert.equal(owner.bundle.version, '2.0.0');
});

test('damaged ownership requires confirmation, preserves original bytes and uses the last committed generation', async (t) => {
  const f = await fixture(t);
  await f.service.repair();
  const state = join(f.project, 'browser-host/state');
  await writeFile(join(state, 'owner.json'), '{broken');
  const evidence = await f.service.inspect();
  assert.equal(evidence.phase, 'confirmationRequired');
  await assert.rejects(f.service.repair(), /HOST_CONFIRMATION_REQUIRED/);
  assert.equal(
    (await f.service.repair({ revision: evidence.revision, confirmReplacement: true })).phase,
    'ready'
  );
  const backup = (await readdir(state)).find((name) => name.startsWith('owner-backup-'));
  assert.equal(await readFile(join(state, backup), 'utf8'), '{broken');
  assert.equal(JSON.parse(await readFile(join(state, 'owner.json'), 'utf8')).generation, 2);
});

for (const failureAt of ['staging', 'active']) {
  test(`${failureAt} startup failure keeps a verified previous bundle without returning ownership to the old installer`, async (t) => {
    const f = await fixture(t);
    await f.service.repair();
    const nextRoot = join(f.root, 'next');
    await f.build('2.0.0', 'next', nextRoot);
    const desired = browserDigest(JSON.parse(await readFile(join(nextRoot, 'host-bundle.json'), 'utf8')));
    const next = new BrowserHostMaintenance(nextRoot, f.project, f.registry, f.probe);
    if (failureAt === 'active') {
      assert.equal((await next.repair()).phase, 'ready');
    }
    f.failedBuilds.add(desired);
    const result = await next.repair();
    assert.equal(result.phase, 'repairable');
    assert(result.checks.some((item) => item.code === 'ROLLBACK_ACTIVE'));
    const owner = JSON.parse(await readFile(join(f.project, 'browser-host/state/owner.json'), 'utf8'));
    assert.equal(owner.bundle.version, '1.0.0');
    assert.equal(owner.sourceVersion, '2.0.0');
    assert.equal(owner.installationBundleId, desired);
    await f.service.remove();
    assert(f.records.filter((item) => item.hive === 'CurrentUser').every((item) => item.path !== null));
    await assert.rejects(f.service.repair(), /HOST_CONFIRMATION_REQUIRED/);
    await next.remove();
    assert(f.records.every((item) => item.path === null));
  });
}

test('a failed current bundle never rolls back into a previous protocol', async (t) => {
  const f = await fixture(t);
  await f.service.repair();
  const nextRoot = join(f.root, 'next');
  await f.build('2.0.0', 'next', nextRoot);
  const next = new BrowserHostMaintenance(nextRoot, f.project, f.registry, f.probe);
  await next.repair();
  const state = join(f.project, 'browser-host/state');
  const history = JSON.parse(await readFile(join(state, 'last-transaction.json'), 'utf8'));
  history.previous.bundle.protocolVersion = 4;
  history.previous.bundleId = browserDigest(history.previous.bundle);
  history.previous.installationBundleId = history.previous.bundleId;
  await writeFile(join(state, 'last-transaction.json'), JSON.stringify(history));
  f.failedBuilds.add(history.target.bundleId);
  await assert.rejects(next.repair(), /HOST_START_FAILED/);
  assert.equal(JSON.parse(await readFile(join(state, 'owner.json'), 'utf8')).bundle.version, '2.0.0');
});

test('explicit repair can replace a conflicted or malformed pending transaction while preserving its evidence', async (t) => {
  const f = await fixture(t);
  f.failEdge(true);
  await assert.rejects(f.service.repair(), /EDGE_WRITE_DENIED/);
  f.failEdge(false);
  f.records.find((item) => item.browser === 'edge' && item.hive === 'CurrentUser').path = join(
    f.root,
    'foreign.json'
  );
  let evidence = await f.service.inspect();
  assert.equal(evidence.phase, 'confirmationRequired');
  assert.equal(
    (await f.service.repair({ revision: evidence.revision, confirmReplacement: true })).phase,
    'ready'
  );
  const state = join(f.project, 'browser-host/state');
  assert((await readdir(state)).some((name) => name.startsWith('abandoned-')));
  await writeFile(join(state, 'transaction.json'), '{incomplete');
  evidence = await f.service.inspect();
  await assert.rejects(f.service.repair(), /HOST_CONFIRMATION_REQUIRED/);
  assert.equal(
    (await f.service.repair({ revision: evidence.revision, confirmReplacement: true })).phase,
    'ready'
  );
  const backups = await Promise.all(
    (await readdir(state))
      .filter((name) => name.startsWith('abandoned-'))
      .map((name) => readFile(join(state, name), 'utf8'))
  );
  assert(backups.includes('{incomplete'));
});
