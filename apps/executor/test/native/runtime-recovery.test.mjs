/**
 * @author Codex
 * @description Verifies explicit grouped recovery, private verified backups, non-destructive failure and lifecycle admission on isolated data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { RuntimeRecovery } from '../../src/maintenance/runtime-recovery.ts';
import { runtimeSnapshotSchema } from '../../src/contracts/runtime.ts';

const nativePath = fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url));

/**
 * Creates a real private old-format journal and a lifecycle that checks the production control reader on restart.
 */
async function fixture(run) {
  const prefix = join(tmpdir(), 'octopus-runtime-recovery-');
  const root = await mkdtemp(prefix);
  const projectRoot = join(root, 'project');
  const native = new NativeFileCommit(nativePath);
  await mkdir(projectRoot);
  await native.createRecovery(join(projectRoot, 'tasks'));
  await native.createRecovery(join(projectRoot, 'connections'));
  const original =
    JSON.stringify({
      kind: 'grant',
      sequence: 1,
      value: {
        clientId: randomUUID(),
        scope: 'device',
        label: 'isolated old grant',
        permissions: ['files.read', 'computer.observe'],
        waitBudgetMs: 120000,
        revoked: false,
        tokenHash: 'a'.repeat(64),
      },
    }) + '\n';
  await native.writePrivateConfig(join(projectRoot, 'tasks/events.jsonl'), original);
  await native.writePrivateConfig(
    join(projectRoot, 'connections/isolated.json'),
    '{"encrypted":"isolated-test"}\n'
  );
  await writeFile(join(projectRoot, 'settings.json'), 'settings sentinel');
  const state = runtimeSnapshotSchema.parse({
    state: 'failed',
    revision: 7,
    pid: null,
    startedAt: null,
    message: '执行服务意外退出',
    startupFailure: 'CONTROL_STORE_INVALID',
    health: { state: 'unknown', checkedAt: null },
    capabilities: {
      basic: { available: false, reason: 'not ready' },
      browser: { available: false, reason: 'not ready' },
      computer: { state: 'stopped', available: false, reason: 'not ready' },
    },
  });
  const runtime = {
    projectRoot,
    /**
     * Returns the current test lifecycle without exposing journal contents.
     */
    readStatus() {
      return structuredClone(state);
    },
    /**
     * Confirms exit before maintenance is allowed to mutate storage.
     */
    async stop() {
      state.state = 'stopped';
      state.revision++;
    },
    /**
     * Uses the real current reader to ensure reset journals admit no old grants or tasks.
     */
    async start() {
      try {
        const store = await ControlStore.open(native, projectRoot);
        assert.equal(store.grants.size, 0);
        assert.equal(store.tasks.size, 0);
        await store.close();
        state.state = 'ready';
      } catch (error) {
        state.state = 'failed';
        state.startupFailure = error.code;
        throw error;
      } finally {
        state.revision++;
      }
    },
  };
  try {
    await run({ root, projectRoot, original, native, runtime, state });
  } finally {
    assert.ok(root.startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  }
}

test('old permission is backed up byte-for-byte; originals retire and unrelated settings survive reset', async () => {
  await fixture(async ({ projectRoot, original, native, runtime }) => {
    const recovery = new RuntimeRecovery(runtime, native);
    const initial = recovery.read();
    assert.equal(initial.issue.recoverable, true);
    await assert.rejects(recovery.run('reset', initial.issue.revision - 1), /状态已变化/);
    await recovery.run('reset', initial.issue.revision);
    const result = recovery.read();
    assert.equal(result.phase, 'succeeded');
    assert.equal(runtime.readStatus().state, 'ready');
    assert.equal(await readFile(join(projectRoot, 'settings.json'), 'utf8'), 'settings sentinel');
    for (const folder of ['data', '.octopus-executor-recovery-originals']) {
      assert.equal(await readFile(join(result.backupPath, folder, 'tasks/events.jsonl'), 'utf8'), original);
      assert.equal((await native.inspect(join(result.backupPath, folder, 'tasks'))).privateAcl, true);
      assert.equal(
        await readFile(join(result.backupPath, folder, 'connections/isolated.json'), 'utf8'),
        '{"encrypted":"isolated-test"}\n'
      );
    }
    assert.equal((await native.inspect(result.backupPath)).privateAcl, true);
    assert.deepEqual(await readdir(join(projectRoot, 'tasks')), []);
    recovery.dismiss();
    assert.equal(recovery.read().phase, 'idle');
    assert.equal(recovery.read().issue, null);
  });
});

test('backup failure preserves both live trees and permits a later explicit retry from stopped state', async () => {
  await fixture(async ({ projectRoot, original, native, runtime }) => {
    const create = native.createRecovery.bind(native);
    native.createRecovery = async (path) =>
      path.includes('.octopus-executor-recovery-') ? { ok: false, privateAcl: false } : create(path);
    const recovery = new RuntimeRecovery(runtime, native);
    await recovery.run('reset', recovery.read().issue.revision);
    assert.match(recovery.read().message, /备份失败，尚未重置/);
    assert.equal(await readFile(join(projectRoot, 'tasks/events.jsonl'), 'utf8'), original);
    assert.equal((await readdir(join(projectRoot, 'connections'))).length, 1);
    assert.equal(recovery.read().issue.recoverable, true);
    native.createRecovery = create;
    await recovery.run('reset', recovery.read().issue.revision);
    assert.equal(recovery.read().phase, 'succeeded');
  });
});

test('unknown failures have diagnostics and retry but never authorize storage reset', async () => {
  await fixture(async ({ projectRoot, original, native, runtime, state }) => {
    state.startupFailure = 'OTHER_STORAGE_FAILURE';
    const recovery = new RuntimeRecovery(runtime, native);
    assert.equal(recovery.read().issue.recoverable, false);
    await assert.rejects(recovery.run('reset', state.revision), /不支持数据重置/);
    assert.equal(await readFile(join(projectRoot, 'tasks/events.jsonl'), 'utf8'), original);
    await recovery.run('retry', state.revision);
    assert.equal(recovery.read().phase, 'failed');
    assert.equal(await readFile(join(projectRoot, 'tasks/events.jsonl'), 'utf8'), original);
  });
});

test('junctions prevent backup and reset without following outside material', async () => {
  await fixture(async ({ root, projectRoot, original, native, runtime }) => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'sentinel'), 'outside');
    await symlink(outside, join(projectRoot, 'connections/link'), 'junction');
    const recovery = new RuntimeRecovery(runtime, native);
    await recovery.run('reset', recovery.read().issue.revision);
    assert.match(recovery.read().message, /备份失败/);
    assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'outside');
    assert.equal(await readFile(join(projectRoot, 'tasks/events.jsonl'), 'utf8'), original);
  });
});

test('partial reset retains complete backup and the failed original; next explicit recovery can finish', async () => {
  await fixture(async ({ projectRoot, original, native, runtime }) => {
    const inspect = native.inspect.bind(native);
    const create = native.createRecovery.bind(native);
    let resetting = false;
    native.createRecovery = async (path) => {
      const result = await create(path);
      if (path.endsWith('.octopus-executor-recovery-originals')) {
        resetting = true;
      }
      return result;
    };
    native.inspect = async (path) =>
      resetting && path === join(projectRoot, 'tasks') ? { ok: false } : inspect(path);
    const recovery = new RuntimeRecovery(runtime, native);
    await recovery.run('reset', recovery.read().issue.revision);
    const first = recovery.read();
    assert.match(first.message, /重置未全部完成/);
    assert.equal(await readFile(join(first.backupPath, 'data/tasks/events.jsonl'), 'utf8'), original);
    assert.equal(await readFile(join(projectRoot, 'tasks/events.jsonl'), 'utf8'), original);
    assert.equal(
      (await readdir(join(first.backupPath, '.octopus-executor-recovery-originals/connections'))).length,
      1
    );
    native.inspect = inspect;
    native.createRecovery = create;
    await recovery.run('reset', recovery.read().issue.revision);
    assert.equal(recovery.read().phase, 'succeeded');
    assert.equal(await readFile(join(first.backupPath, 'data/tasks/events.jsonl'), 'utf8'), original);
  });
});

test('concurrent actions are rejected and application shutdown waits for owned maintenance', async () => {
  await fixture(async ({ native, runtime, state }) => {
    const stop = runtime.stop;
    let release;
    runtime.stop = async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
      await stop();
    };
    const recovery = new RuntimeRecovery(runtime, native);
    const running = recovery.run('reset', state.revision);
    assert.equal(recovery.isBusy(), true);
    await assert.rejects(recovery.run('reset', state.revision), /状态已变化/);
    let closed = false;
    const closing = recovery.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    assert.equal(closed, false);
    release();
    await running;
    await closing;
    assert.equal(closed, true);
  });
});
