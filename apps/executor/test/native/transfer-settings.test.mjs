/**
 * @author Codex
 * @description Verifies configured direction, retained-material quota and physical free-space admission using real NTFS files.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { TransferFiles } from '../../src/runtime/transfer/transfer-files.ts';
import { TransferStore } from '../../src/runtime/transfer/transfer-store.ts';
import { TransferService } from '../../src/runtime/transfer/transfer-service.ts';

/**
 * Waits for actual preparation and cleanup rather than inferring completion from its public status.
 */
async function idle(service, task) {
  for (let attempt = 0; attempt < 500 && service.working(task); attempt++) {
    await delay(10);
  }
  assert.equal(service.working(task), false);
}

test('configured upload/download limits and retained quota are enforced independently of wire ceilings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-transfer-settings-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const limits = { uploadLimitMiB: 1, downloadLimitMiB: 2, temporaryQuotaMiB: 2, minimumFreeSpaceMiB: 0 };
  const owner = randomUUID();
  const taskId = randomUUID();
  try {
    const data = join(root, 'data');
    await mkdir(data);
    const store = await TransferStore.open(native, data);
    const files = new TransferFiles(native, store.root, limits);
    const service = new TransferService(store, files, () => ({ expiresAt: Date.now() + 1800000 }), limits);
    const request = {
      taskId,
      path: join(root, 'target.bin'),
      totalBytes: 1024 ** 2,
      idempotencyKey: 'first',
    };
    await assert.rejects(
      service.control(owner, 'file_upload_prepare', { ...request, totalBytes: 1024 ** 2 + 1 }),
      { code: 'TRANSFER_FILE_LIMIT' }
    );
    const source = join(root, 'source.bin');
    await writeFile(source, Buffer.alloc(2 * 1024 ** 2 + 1));
    const oversized = await service.control(owner, 'file_download_prepare', {
      taskId,
      path: source,
      idempotencyKey: 'large-download',
    });
    await idle(service, taskId);
    assert.equal(
      (await service.control(owner, 'file_transfer_status', { transferId: oversized.transferId })).errorCode,
      'TRANSFER_FILE_LIMIT'
    );
    const accepted = await service.control(owner, 'file_upload_prepare', request);
    await idle(service, taskId);
    const cleanup = files.cleanup.bind(files);
    files.cleanup = async () => {
      throw new Error('Simulated cleanup failure');
    };
    const cancelled = await service.control(owner, 'file_transfer_cancel', {
      transferId: accepted.transferId,
    });
    assert.equal(cancelled.cleanupPending, true);
    assert.equal(store.records.get(accepted.transferId).reservedBytes, 1024 ** 2);
    await writeFile(source, Buffer.alloc(2 * 1024 ** 2));
    const quota = await service.control(owner, 'file_download_prepare', {
      taskId,
      path: source,
      idempotencyKey: 'quota',
    });
    await idle(service, taskId);
    assert.equal(
      (await service.control(owner, 'file_transfer_status', { transferId: quota.transferId })).errorCode,
      'TRANSFER_QUOTA'
    );
    limits.uploadLimitMiB = 2;
    assert.equal(service.settings().uploadLimitMiB, 1, 'active limits must be a detached snapshot');
    files.cleanup = cleanup;
    await service.stopTask(taskId);
    assert.equal(store.records.get(accepted.transferId).reservedBytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('free-space reserve is applied to the actual destination volume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-transfer-space-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    const limits = { uploadLimitMiB: 1, downloadLimitMiB: 1, temporaryQuotaMiB: 2, minimumFreeSpaceMiB: 0 };
    await new TransferFiles(native, root, limits).capacity(root, 0);
    const disk = await statfs(root);
    const available = disk.bavail * disk.bsize;
    const reserve = Math.min(1048576, Math.floor(available / 1024 ** 2) + 64);
    const allocation = Math.max(0, available - reserve * 1024 ** 2 + 64 * 1024 ** 2);
    await assert.rejects(
      new TransferFiles(native, root, { ...limits, minimumFreeSpaceMiB: reserve }).capacity(root, allocation),
      { code: 'DISK_FULL' }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project transfer storage preserves records and ignores previous AppData history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-transfer-project-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    const data = join(root, 'appdata');
    const project = join(root, 'project');
    await mkdir(data);
    await mkdir(project);
    const old = join(data, '.octopus-executor-recovery-transfers');
    await mkdir(old);
    await writeFile(join(old, 'events.jsonl'), '{invalid previous format');
    const store = await TransferStore.open(native, project);
    assert.equal(store.root, join(project, 'transfers'));
    assert.equal(store.materialRoot, store.root);
    const transferId = randomUUID();
    await store.save({
      transferId,
      ownerId: randomUUID(),
      taskId: randomUUID(),
      key: 'project',
      fingerprint: 'a'.repeat(64),
      direction: 'upload',
      status: 'cancelled',
      path: join(root, 'output.bin'),
      totalBytes: 0,
      transferredBytes: 0,
      destinationEffect: 'not_applied',
      cleanupPending: false,
      expiresAt: Date.now() + 10000,
      pollAfterMs: 1000,
      reservedBytes: 0,
      updatedAt: Date.now(),
      directory: store.root,
    });
    assert.equal((await TransferStore.open(native, project)).records.get(transferId).status, 'cancelled');
    assert.equal(await readFile(join(old, 'events.jsonl'), 'utf8'), '{invalid previous format');
    await writeFile(join(store.root, 'events.jsonl'), '{partial');
    await assert.rejects(TransferStore.open(native, project), /Invalid transfer journal/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
