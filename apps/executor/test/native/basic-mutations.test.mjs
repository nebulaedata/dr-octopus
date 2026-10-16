/**
 * @author Codex
 * @description Verifies authorized read/write/edit calls, shared task ordering, stop drain and recovery isolation.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';

const binary = fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url));

/**
 * Allocates only owned temporary workspaces and drains all admitted operations before removing their files.
 */
async function fixture(run, Native = NativeFileCommit) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-task-files-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const native = new Native(binary);
  const publication = await FilePublication.open(native, root);
  const files = new BasicTools(publication);
  try {
    await files.registerTask({
      taskId: 'writer',
      ownerId: 'client',
      cwd: workspace,
      permissions: ['files.write'],
    });
    await run({ root, workspace, files, native });
  } finally {
    await files.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('device file mutations allow cross-directory writes while rejecting missing tasks, wrong owners and read-only grants', async () => {
  await fixture(async ({ workspace, files }) => {
    await files.registerTask({
      taskId: 'reader',
      ownerId: 'client',
      cwd: workspace,
      permissions: ['files.read'],
    });
    const input = { taskId: 'writer', path: 'a.txt', content: 'x', idempotencyKey: 'key' };
    await assert.rejects(files.write('other', input), { code: 'TASK_NOT_FOUND' });
    await assert.rejects(files.write('client', { ...input, taskId: 'missing' }), { code: 'TASK_NOT_FOUND' });
    await assert.rejects(files.write('client', { ...input, taskId: 'reader' }), {
      code: 'PERMISSION_DENIED',
    });
    await assert.rejects(
      files.edit('client', {
        taskId: 'reader',
        path: 'a.txt',
        edits: [{ oldText: 'a', newText: 'b' }],
        idempotencyKey: 'edit',
      }),
      { code: 'PERMISSION_DENIED' }
    );
    assert.equal(
      (await files.write('client', { ...input, path: '..\\outside.txt', idempotencyKey: 'cross-directory' }))
        .fileEffect,
      'applied'
    );
    assert.equal(await readFile(join(workspace, '..', 'outside.txt'), 'utf8'), 'x');
    await assert.rejects(files.write('client', { ...input, idempotencyKey: 'extra', roots: [workspace] }), {
      code: 'INVALID_INPUT',
    });
    await assert.rejects(files.write('client', { ...input, idempotencyKey: 'binary', content: '\0' }), {
      code: 'INVALID_INPUT',
    });
    await assert.rejects(files.stopTask('other', 'writer'), { code: 'TASK_NOT_FOUND' });
    assert.throws(() => files.taskStatus('other', 'writer'), { code: 'TASK_NOT_FOUND' });
  });
});

test('read/edit/write share observations and task order, with one publication and explicit no-change', async () => {
  await fixture(async ({ workspace, files }) => {
    const path = join(workspace, 'a.txt');
    await writeFile(path, '\ufeffalpha\r\nbeta');
    await assert.rejects(
      files.write('client', { taskId: 'writer', path: 'a.txt', content: 'x', idempotencyKey: 'unobserved' }),
      { code: 'EXPECTED_VERSION_REQUIRED' }
    );
    await assert.rejects(
      files.edit('client', {
        taskId: 'writer',
        path: 'a.txt',
        edits: [{ oldText: 'alpha', newText: 'one' }],
        idempotencyKey: 'unobserved-edit',
      }),
      { code: 'EXPECTED_VERSION_REQUIRED' }
    );
    const reading = files.read('client', { taskId: 'writer', path: 'a.txt' });
    const editing = files.edit('client', {
      taskId: 'writer',
      path: 'a.txt',
      edits: [{ oldText: 'alpha\nbeta', newText: 'one\ntwo' }],
      idempotencyKey: 'edit',
    });
    const [original, edited] = await Promise.all([reading, editing]);
    assert.equal(edited.status, 'applied');
    assert.equal(edited.fileEffect, 'applied');
    assert.equal(edited.executionState, 'quiescent');
    assert.equal(edited.replacements, 1);
    assert.notEqual(edited.version, original.version);
    assert.equal(await readFile(path, 'utf8'), '\ufeffone\r\ntwo');
    const unchanged = await files.edit('client', {
      taskId: 'writer',
      path: 'a.txt',
      edits: [{ oldText: 'one', newText: 'one' }],
      idempotencyKey: 'same',
    });
    assert.equal(unchanged.status, 'no_change');
    assert.equal(unchanged.fileEffect, 'not_applied');
    assert.equal(unchanged.diff.addedBytes, 0);
    const written = await files.write('client', {
      taskId: 'writer',
      path: 'a.txt',
      content: 'whole',
      idempotencyKey: 'write',
    });
    assert.equal(written.status, 'applied');
    assert.equal((await files.read('client', { taskId: 'writer', path: 'a.txt' })).version, written.version);
    assert.equal(await readFile(path, 'utf8'), 'whole');
  });
});

test('implicit-version duplicate calls return the first outcome even after later writes; tool-key reuse rejects', async () => {
  await fixture(async ({ workspace, files }) => {
    const input = { taskId: 'writer', path: 'a.txt', content: 'first', idempotencyKey: 'create' };
    const [first, duplicate] = await Promise.all([
      files.write('client', input),
      files.write('client', input),
    ]);
    assert.deepEqual(first, duplicate);
    await files.write('client', { ...input, content: 'second', idempotencyKey: 'second' });
    first.status = 'uncertain';
    assert.deepEqual(await files.write('client', input), duplicate);
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'second');
    await assert.rejects(files.write('client', { ...input, content: 'changed' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(
      files.edit('client', {
        taskId: 'writer',
        path: 'a.txt',
        edits: [{ oldText: 'second', newText: 'third' }],
        idempotencyKey: 'create',
      }),
      { code: 'IDEMPOTENCY_CONFLICT' }
    );
    await files.stopTask('client', 'writer');
    assert.deepEqual(await files.write('client', input), duplicate);
    await assert.rejects(files.write('client', { ...input, idempotencyKey: 'after-stop' }), {
      code: 'TASK_STOPPED',
    });
  });
});

test('batch edit failure changes no target bytes; stale explicit versions reject before publishing', async () => {
  await fixture(async ({ workspace, files }) => {
    const path = join(workspace, 'a.txt');
    await writeFile(path, 'alpha beta');
    const version = (await files.read('client', { taskId: 'writer', path: 'a.txt' })).version;
    await assert.rejects(
      files.edit('client', {
        taskId: 'writer',
        path: 'a.txt',
        edits: [
          { oldText: 'alpha', newText: 'changed' },
          { oldText: 'missing', newText: 'x' },
        ],
        idempotencyKey: 'invalid',
      }),
      { code: 'EDIT_NOT_FOUND' }
    );
    assert.equal(await readFile(path, 'utf8'), 'alpha beta');
    await writeFile(path, 'external');
    await assert.rejects(
      files.edit('client', {
        taskId: 'writer',
        path: 'a.txt',
        expectedVersion: version,
        edits: [{ oldText: 'external', newText: 'x' }],
        idempotencyKey: 'stale-edit',
      }),
      { code: 'FILE_VERSION_CONFLICT' }
    );
    await assert.rejects(
      files.write('client', { taskId: 'writer', path: 'a.txt', content: 'x', idempotencyKey: 'stale-write' }),
      { code: 'FILE_VERSION_CONFLICT' }
    );
    assert.equal(await readFile(path, 'utf8'), 'external');
  });
});

test('cross-task edits serialize the full transaction and the stale observer cannot partially publish', async () => {
  await fixture(async ({ workspace, files }) => {
    await writeFile(join(workspace, 'a.txt'), 'alpha\nbeta');
    await files.registerTask({
      taskId: 'other',
      ownerId: 'client',
      cwd: workspace,
      permissions: ['files.write'],
    });
    await Promise.all(['writer', 'other'].map((taskId) => files.read('client', { taskId, path: 'a.txt' })));
    const results = await Promise.allSettled([
      files.edit('client', {
        taskId: 'writer',
        path: 'a.txt',
        edits: [{ oldText: 'alpha', newText: 'one' }],
        idempotencyKey: 'a',
      }),
      files.edit('client', {
        taskId: 'other',
        path: 'a.txt',
        edits: [{ oldText: 'beta', newText: 'two' }],
        idempotencyKey: 'b',
      }),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].reason.code, 'FILE_VERSION_CONFLICT');
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'one\nbeta');
  });
});

test('stop waits for a dispatched native commit, rejects queued work, and preserves the completed result', async () => {
  let entered;
  let release;
  const dispatched = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  class GatedNative extends NativeFileCommit {
    /**
     * Holds an admitted dispatch until the test releases it, then invokes the real native implementation.
     */
    async commit(input) {
      entered();
      await gate;
      return super.commit(input);
    }
  }
  await fixture(async ({ workspace, files }) => {
    const input = { taskId: 'writer', path: 'a.txt', content: 'first', idempotencyKey: 'first' };
    const running = files.write('client', input);
    await dispatched;
    const queued = assert.rejects(
      files.write('client', { ...input, content: 'later', idempotencyKey: 'queued' }),
      { code: 'TASK_STOPPED' }
    );
    let finished = false;
    const stopping = files.stopTask('client', 'writer').then(() => {
      finished = true;
    });
    await Promise.resolve();
    assert.equal(finished, false);
    assert.equal(files.taskStatus('client', 'writer').state, 'stopping');
    release();
    const result = await running;
    await Promise.all([stopping, queued]);
    assert.equal(result.status, 'applied');
    assert.equal(files.taskStatus('client', 'writer').state, 'stopped');
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'first');
    assert.deepEqual(await files.write('client', input), result);
  }, GatedNative);
});

test('external commit conflict isolates only its task and a stopped task can still retrieve that unknown result', async () => {
  class RacingNative extends NativeFileCommit {
    /**
     * Writes externally to the same file identity immediately before the real replacement.
     */
    async commit(input) {
      if (input.targetIdentity !== 'absent') {
        await writeFile(input.target, 'external');
      }
      return super.commit(input);
    }
  }
  await fixture(async ({ workspace, files }) => {
    await writeFile(join(workspace, 'a.txt'), 'old');
    await files.read('client', { taskId: 'writer', path: 'a.txt' });
    const input = { taskId: 'writer', path: 'a.txt', content: 'ours', idempotencyKey: 'race' };
    const result = await files.write('client', input);
    assert.equal(result.status, 'conflict_after_commit');
    assert.equal(result.fileEffect, 'unknown');
    assert.equal(files.taskStatus('client', 'writer').isolation.code, 'FILE_CONFLICT_AFTER_COMMIT');
    await assert.rejects(files.read('client', { taskId: 'writer', path: 'a.txt' }), {
      code: 'TASK_ISOLATED',
    });
    await assert.rejects(files.write('client', { ...input, path: 'other.txt', idempotencyKey: 'new' }), {
      code: 'TASK_ISOLATED',
    });
    await files.stopTask('client', 'writer');
    assert.equal(files.taskStatus('client', 'writer').state, 'isolated');
    assert.deepEqual(await files.write('client', input), result);
    await files.registerTask({
      taskId: 'other',
      ownerId: 'client',
      cwd: workspace,
      permissions: ['files.write'],
    });
    assert.equal(
      (
        await files.write('client', {
          taskId: 'other',
          path: 'other.txt',
          content: 'ok',
          idempotencyKey: 'new',
        })
      ).status,
      'applied'
    );
  }, RacingNative);
});

test('edit diff is truthful, UTF-8 aligned and below 50 KiB including JSON escaping', async () => {
  await fixture(async ({ workspace, files }) => {
    const oldText = '😀'.repeat(3000);
    const newText = '\u0001'.repeat(12000);
    await writeFile(join(workspace, 'a.txt'), oldText);
    await files.read('client', { taskId: 'writer', path: 'a.txt' });
    const result = await files.edit('client', {
      taskId: 'writer',
      path: 'a.txt',
      edits: [{ oldText, newText }],
      idempotencyKey: 'diff',
    });
    assert.ok(Buffer.byteLength(JSON.stringify(result.diff)) < 50 * 1024);
    assert.equal(result.diff.truncated, true);
    assert.ok(oldText.startsWith(result.diff.before));
    assert.ok(newText.startsWith(result.diff.after));
    assert.equal(result.diff.removedBytes, Buffer.byteLength(oldText));
    assert.equal(result.diff.addedBytes, Buffer.byteLength(newText));
  });
});

test('uncertain dispatch isolates its task, restart preserves the file gate and refuses old task identity reuse', async () => {
  class FailingNative extends NativeFileCommit {
    /**
     * Simulates a native dispatch failure after commit_started has been flushed.
     */
    async commit() {
      throw new Error('injected native failure');
    }
  }
  await fixture(async ({ workspace, root, files }) => {
    const input = { taskId: 'writer', path: 'a.txt', content: 'new', idempotencyKey: 'unknown' };
    const result = await files.write('client', input);
    assert.equal(result.status, 'uncertain');
    assert.equal(result.fileEffect, 'unknown');
    assert.equal(files.taskStatus('client', 'writer').isolation.code, 'FILE_COMMIT_UNCERTAIN');
    assert.deepEqual(await files.write('client', input), result);
    await files.close();
    const publication = await FilePublication.open(new NativeFileCommit(binary), root);
    const reopened = new BasicTools(publication);
    const grant = {
      taskId: 'writer',
      ownerId: 'client',
      cwd: workspace,
      permissions: ['files.write'],
    };
    try {
      await assert.rejects(reopened.registerTask(grant), { code: 'TASK_ID_REUSED' });
      await reopened.registerTask({ ...grant, taskId: 'fresh' });
      await assert.rejects(reopened.write('client', { ...input, taskId: 'fresh', idempotencyKey: 'fresh' }), {
        code: 'FILE_RECOVERY_REQUIRED',
      });
      assert.equal(reopened.taskStatus('client', 'fresh').state, 'isolated');
    } finally {
      await reopened.close();
    }
  }, FailingNative);
});
