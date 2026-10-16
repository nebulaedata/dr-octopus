/**
 * @author Codex
 * @description Verifies durable device identity, legacy initialization and refusal of lost or corrupted records.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DeviceIdentityStore } from '../../src/main/device-identity.ts';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { deviceNameSchema, deviceConnectionKey } from '../../src/contracts/device-identity.ts';

/**
 * Owns fresh temporary data and the production private native writer.
 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-device-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    await run(root, native);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('project initialization retains settings and identity across rename and restart', async () => {
  await fixture(async (root, native) => {
    const legacyDirectory = join(root, '.octopus-executor-recovery-settings');
    assert.equal((await native.createRecovery(legacyDirectory)).ok, true);
    assert.equal(
      (
        await native.writePrivateConfig(
          join(legacyDirectory, '0001.json'),
          JSON.stringify({ sequence: 1, port: 30001 })
        )
      ).ok,
      true
    );
    const settings = await ConnectionSettings.open(native, root);
    await settings.save({ port: 30001, networkAddress: null });
    const original = await readFile(join(root, '.octopus-executor-recovery-settings', '0001.json'));
    const owner = await DeviceIdentityStore.open(native, root, settings.hasIdentity());
    const first = owner.read();
    assert.equal(deviceNameSchema.safeParse(first.deviceName).success, true);
    await settings.save({ port: settings.read().port, networkAddress: null }, true);
    assert.equal((await ConnectionSettings.open(native, root)).hasIdentity(), true);
    assert.equal(settings.read().port, 30001);
    await owner.rename('  张的办公电脑  ');
    const renamed = owner.read();
    assert.equal(renamed.deviceName, '张的办公电脑');
    assert.equal(renamed.deviceId, first.deviceId);
    assert.equal(deviceConnectionKey(renamed), deviceConnectionKey(first));
    assert.deepEqual((await DeviceIdentityStore.open(native, root, true)).read(), renamed);
    renamed.deviceName = 'detached';
    assert.equal(owner.read().deviceName, '张的办公电脑');
    assert.deepEqual(
      await readFile(join(root, '.octopus-executor-recovery-settings', '0001.json')),
      original
    );
  });
});

test('interrupted first initialization retains ID; missing initialized data refuses recreation', async () => {
  await fixture(async (root, native) => {
    const settings = await ConnectionSettings.open(native, root);
    await settings.save({ port: 19876, networkAddress: null }, true);
    assert.equal(settings.hasIdentity(), true);
    assert.equal(settings.read().saved, false);
    const recovered = await ConnectionSettings.open(native, root);
    assert.equal(recovered.read().saved, false);
    await recovered.save({ port: 30001, networkAddress: null });
    assert.equal(recovered.read().saved, true);
    const first = (await DeviceIdentityStore.open(native, root, false)).read();
    assert.deepEqual((await DeviceIdentityStore.open(native, root, false)).read(), first);
    const directory = join(root, 'device');
    await rm(directory, { recursive: true });
    await assert.rejects(DeviceIdentityStore.open(native, root, true));
    assert.equal((await native.inspect(directory)).ok, false);
  });
});

test('invalid names, failed writes and corrupt identity never acknowledge a replacement', async () => {
  await fixture(async (root, native) => {
    const owner = await DeviceIdentityStore.open(native, root, false);
    const first = owner.read();
    for (const name of ['', 'a'.repeat(65), 'a\nb', '\nname', 'name\n', 'a\u202eb', 'a\u0000b']) {
      await assert.rejects(owner.rename(name));
      assert.deepEqual(owner.read(), first);
    }
    const file = join(root, 'device', '0001.json');
    await writeFile(file, '{broken');
    await assert.rejects(DeviceIdentityStore.open(native, root, true));
    assert.equal(await readFile(file, 'utf8'), '{broken');
  });
  await fixture(async (root, native) => {
    const failing = Object.create(native);
    failing.writePrivateConfig = async () => ({ ok: false });
    const first = (await DeviceIdentityStore.open(native, root, false)).read();
    const owner = await DeviceIdentityStore.open(failing, root, true);
    await assert.rejects(owner.rename('new name'));
    assert.deepEqual(owner.read(), first);
    await assert.rejects(owner.rename('another name'));
  });
});

test('device ID changes and initialization marker regression are refused', async () => {
  await fixture(async (root, native) => {
    const owner = await DeviceIdentityStore.open(native, root, false);
    await owner.rename('second');
    const file = join(root, 'device', '0002.json');
    const record = JSON.parse(await readFile(file, 'utf8'));
    record.deviceId = '89b7dada-bb9d-4b25-a1ef-ff6a3e8b189a';
    await writeFile(file, JSON.stringify(record));
    await assert.rejects(DeviceIdentityStore.open(native, root, true));
    const settings = await ConnectionSettings.open(native, root);
    await settings.save({ port: settings.read().port, networkAddress: null }, true);
    await settings.save({ port: settings.read().port, networkAddress: null });
    const settingsFile = join(root, 'settings.json');
    const changed = JSON.parse(await readFile(settingsFile, 'utf8'));
    delete changed.identityInitialized;
    await writeFile(settingsFile, JSON.stringify(changed));
    await assert.rejects(ConnectionSettings.open(native, root));
  });
});
