/**
 * @author Codex
 * @description Verifies private offline data backup/restoration, retained settings and grants, corruption refusal and non-overwriting failures on isolated native data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupData, restoreData } from '../../src/maintenance/data-backup.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { randomUUID } from 'node:crypto';

const native = new NativeFileCommit(
  fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
);

/**
 * Creates stopped test data and removes only its verified temporary root after all readers close.
 */
async function fixture(run) {
  const prefix = join(tmpdir(), 'octopus-data-backup-');
  const root = await mkdtemp(prefix);
  const data = join(root, 'data');
  await mkdir(data);
  try {
    await run({ root, data });
  } finally {
    assert.ok(root.startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  }
}

test('stopped data round-trip retains actual private grants, settings and empty directories', async () => {
  await fixture(async ({ root, data }) => {
    const settings = await ConnectionSettings.open(native, data);
    await settings.save({ port: 23456, networkAddress: null });
    const store = await ControlStore.open(native, data);
    const clientId = randomUUID();
    const grant = {
      clientId,
      scope: 'device',
      label: 'isolated backup',
      permissions: ['files.read'],
      tokenHash: 'a'.repeat(64),
      waitBudgetMs: 120000,
      revoked: false,
    };
    await store.saveGrant(grant);
    await store.close();
    await mkdir(join(data, 'empty'));
    const backup = join(root, '.octopus-executor-recovery-backup');
    const restored = join(root, '.octopus-executor-recovery-restored');
    const result = await backupData(native, data, backup);
    assert.ok(result.files > 0);
    await restoreData(native, backup, restored);
    assert.equal((await native.inspect(backup)).privateAcl, true);
    assert.equal(
      (await native.inspect(join(restored, 'tasks'))).privateAcl,
      true
    );
    assert.equal((await ConnectionSettings.open(native, restored)).read().port, 23456);
    const recovered = await ControlStore.open(native, restored);
    try {
      assert.deepEqual(recovered.grants.get(clientId), grant);
    } finally {
      await recovered.close();
    }
    await access(join(restored, 'empty'));
    await assert.rejects(restoreData(native, backup, restored), /CREATE_FAILED/);
    assert.equal((await ConnectionSettings.open(native, restored)).read().port, 23456);
  });
});

test('changed payload and future backup versions fail before creating a restore path', async () => {
  await fixture(async ({ root, data }) => {
    await writeFile(join(data, 'sentinel'), 'original');
    const backup = join(root, '.octopus-executor-recovery-backup');
    const output = join(root, '.octopus-executor-recovery-restored');
    await backupData(native, data, backup);
    await writeFile(join(backup, 'data/sentinel'), 'changed');
    await assert.rejects(restoreData(native, backup, output), /BACKUP_CHANGED/);
    await assert.rejects(access(output), { code: 'ENOENT' });
    const metadata = join(backup, 'executor-data-backup.json');
    const record = JSON.parse(await readFile(metadata, 'utf8'));
    await writeFile(metadata, JSON.stringify({ ...record, schemaVersion: 2 }));
    await assert.rejects(restoreData(native, backup, output));
    assert.equal(await readFile(join(data, 'sentinel'), 'utf8'), 'original');
  });
});

test('nested outputs, existing backups and junctions never overwrite or follow user data', async () => {
  await fixture(async ({ root, data }) => {
    await writeFile(join(data, 'sentinel'), 'original');
    await assert.rejects(backupData(native, data, join(data, 'backup')), /OVERLAP/);
    await assert.rejects(backupData(native, data, root), /OVERLAP/);
    const backup = join(root, '.octopus-executor-recovery-backup');
    await backupData(native, data, backup);
    await assert.rejects(backupData(native, data, backup), /CREATE_FAILED/);
    const foreign = join(root, 'foreign');
    await mkdir(foreign);
    await writeFile(join(foreign, 'untouched'), 'outside');
    await symlink(foreign, join(data, 'junction'), 'junction');
    await assert.rejects(backupData(native, data, join(root, 'rejected')), /REPARSE_REJECTED/);
    assert.equal(await readFile(join(foreign, 'untouched'), 'utf8'), 'outside');
    assert.equal(await readFile(join(data, 'sentinel'), 'utf8'), 'original');
  });
});

test('restored incompatible control data is rejected without reset or mutation', async () => {
  await fixture(async ({ root, data }) => {
    const store = await ControlStore.open(native, data);
    await store.close();
    const journal = join(data, 'tasks/events.jsonl');
    await writeFile(journal, JSON.stringify({ kind: 'future-format', sequence: 1, value: {} }) + '\n');
    const original = await readFile(journal);
    const backup = join(root, '.octopus-executor-recovery-backup');
    const restored = join(root, '.octopus-executor-recovery-restored');
    await backupData(native, data, backup);
    await restoreData(native, backup, restored);
    await assert.rejects(
      ControlStore.open(native, restored),
      (error) => error.code === 'CONTROL_STORE_INVALID'
    );
    assert.deepEqual(
      await readFile(join(restored, 'tasks/events.jsonl')),
      original
    );
    assert.deepEqual(await readFile(journal), original);
  });
});

test('unreleased workspace grants are rejected without migration, reset or rewriting retained bytes', async () => {
  await fixture(async ({ data }) => {
    const store = await ControlStore.open(native, data);
    const clientId = randomUUID();
    await store.saveGrant({
      clientId,
      scope: 'device',
      label: 'obsolete fixture',
      permissions: ['files.read'],
      tokenHash: 'a'.repeat(64),
      waitBudgetMs: 120000,
      revoked: false,
    });
    await store.close();
    const journal = join(data, 'tasks/events.jsonl');
    const record = JSON.parse(await readFile(journal, 'utf8'));
    delete record.value.scope;
    record.value.workspaceId = randomUUID();
    record.value.root = data;
    await writeFile(journal, JSON.stringify(record) + '\n');
    const original = await readFile(journal);
    await assert.rejects(ControlStore.open(native, data), { code: 'CONTROL_STORE_INVALID' });
    assert.deepEqual(await readFile(journal), original);
  });
});
