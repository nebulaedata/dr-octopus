/**
 * @author Codex
 * @description Verifies authoritative settings, preserved import evidence, publication recovery and transfer configuration boundaries.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { settingsInputSchema, networkAddressSchema } from '../../src/contracts/connection-settings.ts';
import { defaultTransferSettings, transferSettingsSchema } from '../../src/contracts/transfer-settings.ts';
import { executorProjectRoot } from '../../src/main/project-storage.ts';

/**
 * Owns only a fresh directory; no test resolves the user's real project storage.
 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-settings-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    await run(root, native);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Creates the previous protected format explicitly, preserving its bytes for import assertions.
 */
async function legacy(native, root, record) {
  const directory = join(root, '.octopus-executor-recovery-settings');
  assert.equal((await native.createRecovery(directory)).ok, true);
  const path = join(directory, '0001.json');
  const text = JSON.stringify({ sequence: 1, port: 30004, ...record });
  assert.equal((await native.writePrivateConfig(path, text)).ok, true);
  return { path, text };
}

test('formal settings use project root; defaults, transfer fields and all UI preferences persist privately', async () =>
  fixture(async (root, native) => {
    const project = join(root, 'home', '.dr-octopus', 'executor');
    assert.equal(executorProjectRoot(join(root, 'home'), root, false), project);
    assert.equal(executorProjectRoot(join(root, 'home'), root, true), join(root, 'project'));
    const owner = await ConnectionSettings.open(native, project);
    assert.deepEqual(owner.read(), {
      port: 19876,
      networkAddress: null,
      closeBehavior: 'tray',
      themeSource: 'system',
      transfer: defaultTransferSettings,
      saved: false,
    });
    const transfer = {
      uploadLimitMiB: 32,
      downloadLimitMiB: 64,
      temporaryQuotaMiB: 128,
      minimumFreeSpaceMiB: 16,
    };
    await owner.save({ port: 30001, networkAddress: '10.1.2.3', transfer }, true);
    for (const [themeSource, closeBehavior] of [
      ['dark', 'taskbar'],
      ['light', 'exit'],
      ['system', 'tray'],
    ]) {
      await owner.save({ port: 30001, networkAddress: '10.1.2.3', transfer, themeSource, closeBehavior });
      const reopened = await ConnectionSettings.open(native, project);
      assert.equal(reopened.read().themeSource, themeSource);
      assert.equal(reopened.read().closeBehavior, closeBehavior);
      assert.deepEqual(reopened.read().transfer, transfer);
      assert.equal(reopened.hasIdentity(), true);
    }
    const path = join(project, 'settings.json');
    assert.equal((await native.inspect(path)).privateAcl, true);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).port, 30001);
    assert.deepEqual((await readdir(project)).sort(), ['settings-recovery', 'settings.json']);
    assert.deepEqual((await readdir(join(project, 'settings-recovery'))).sort(), [
      'device-initialized.json',
      'initialized.json',
    ]);
    const detached = owner.read();
    detached.transfer.uploadLimitMiB = 1;
    assert.equal(owner.read().transfer.uploadLimitMiB, 32);
    await assert.rejects(owner.save({ port: 0, networkAddress: null }));
    assert.equal(owner.read().port, 30001);
  }));

test('previous settings are never imported and missing initialized project settings refuse fallback', async () =>
  fixture(async (root, native) => {
    const old = await legacy(native, root, { identityInitialized: true });
    const owner = await ConnectionSettings.open(native, root);
    assert.equal(owner.read().port, 19876);
    assert.equal(owner.read().themeSource, 'system');
    assert.equal(owner.read().closeBehavior, 'tray');
    assert.deepEqual(owner.read().transfer, defaultTransferSettings);
    await owner.save({ port: 30005, networkAddress: null, closeBehavior: 'taskbar' });
    assert.equal(await readFile(old.path, 'utf8'), old.text);
    await writeFile(old.path, '{old records are no longer authoritative');
    assert.equal((await ConnectionSettings.open(native, root)).read().port, 30005);
    await rm(join(root, 'settings.json'));
    await assert.rejects(ConnectionSettings.open(native, root), /缺失/);
  }));

test('corrupt formal or previous settings and unknown recovery material fail without deleting evidence', async () => {
  await fixture(async (root, native) => {
    const owner = await ConnectionSettings.open(native, root);
    await owner.save({ port: 30003, networkAddress: null });
    const path = join(root, 'settings.json');
    await writeFile(path, '{partial');
    await assert.rejects(ConnectionSettings.open(native, root));
    assert.equal(await readFile(path, 'utf8'), '{partial');
  });
  await fixture(async (root, native) => {
    const old = await legacy(native, root, {});
    await writeFile(old.path, '{bad');
    assert.equal((await ConnectionSettings.open(native, root)).read().port, 19876);
    assert.equal(await readFile(old.path, 'utf8'), '{bad');
  });
  await fixture(async (root, native) => {
    await ConnectionSettings.open(native, root);
    const path = join(root, 'settings-recovery', 'unexpected');
    await writeFile(path, 'keep');
    await assert.rejects(ConnectionSettings.open(native, root), /未知/);
    assert.equal(await readFile(path, 'utf8'), 'keep');
  });
});

test('interrupted publication reconciles actual settings without a second native commit', async () =>
  fixture(async (root, native) => {
    const owner = await ConnectionSettings.open(native, root);
    await owner.save({ port: 30001, networkAddress: null });
    const commit = native.commit.bind(native);
    let calls = 0;
    native.commit = async (input) => {
      calls++;
      await commit(input);
      throw new Error('lost completion');
    };
    await assert.rejects(owner.save({ port: 30002, networkAddress: null }), /lost completion/);
    assert.equal(owner.read().port, 30001);
    const reopened = await ConnectionSettings.open(native, root);
    assert.equal(reopened.read().port, 30002);
    assert.equal(calls, 1);
    assert.deepEqual((await readdir(root)).sort(), ['settings-recovery', 'settings.json']);
  }));

test('a stale settings writer refuses overwriting changes from another owner', async () =>
  fixture(async (root, native) => {
    const first = await ConnectionSettings.open(native, root);
    await first.save({ port: 30001, networkAddress: null });
    const second = await ConnectionSettings.open(native, root);
    await first.save({ port: 30002, networkAddress: null });
    await assert.rejects(second.save({ port: 30003, networkAddress: null }), /其他程序/);
    assert.equal((await ConnectionSettings.open(native, root)).read().port, 30002);
  }));

test('a concurrent edit during native replacement preserves its backup and blocks automatic recovery', async () =>
  fixture(async (root, native) => {
    const owner = await ConnectionSettings.open(native, root);
    await owner.save({ port: 30001, networkAddress: null });
    const path = join(root, 'settings.json');
    const commit = native.commit.bind(native);
    const competing = JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), port: 31000 });
    native.commit = async (input) => {
      await writeFile(path, competing);
      return commit(input);
    };
    await assert.rejects(owner.save({ port: 30002, networkAddress: null }), /并发设置变更/);
    await assert.rejects(ConnectionSettings.open(native, root), /并发设置变更/);
    const evidence = (await readdir(root)).find((name) =>
      name.startsWith('.octopus-executor-recovery-settings-')
    );
    assert.ok(evidence);
    assert.equal(await readFile(join(root, evidence, 'previous.json'), 'utf8'), competing);
  }));

test('transfer settings validate direction ceilings, quota relationships and disk reserve independently', () => {
  assert.equal(transferSettingsSchema.safeParse(defaultTransferSettings).success, true);
  for (const changes of [
    { uploadLimitMiB: 2049 },
    { downloadLimitMiB: 0 },
    { uploadLimitMiB: 1.5 },
    { temporaryQuotaMiB: 1024 },
    { minimumFreeSpaceMiB: -1 },
    { minimumFreeSpaceMiB: Infinity },
  ]) {
    assert.equal(transferSettingsSchema.safeParse({ ...defaultTransferSettings, ...changes }).success, false);
  }
  assert.equal(
    transferSettingsSchema.safeParse({ ...defaultTransferSettings, minimumFreeSpaceMiB: 0 }).success,
    true
  );
  for (const input of [{ port: 0 }, { port: 65536 }, { port: 1.5 }, { port: 30000, host: '0.0.0.0' }]) {
    assert.equal(settingsInputSchema.safeParse(input).success, false);
  }
  for (const address of [
    '10.1.2.3',
    '172.16.0.2',
    '172.31.255.254',
    '192.168.1.2',
    '100.64.0.2',
    '100.127.255.254',
  ]) {
    assert.equal(networkAddressSchema.safeParse(address).success, true);
  }
  for (const address of [
    '0.0.0.0',
    '127.0.0.1',
    'localhost',
    '::1',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '10.01.2.3',
    '10.1.2.3:123',
  ]) {
    assert.equal(networkAddressSchema.safeParse(address).success, false);
  }
});
