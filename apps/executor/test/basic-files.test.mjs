/**
 * @author Codex
 * @description Verifies Basic read authority, stable pagination and atomic edit preparation on disposable files.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, link, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BasicTools } from '../src/runtime/basic/basic-tools.ts';
import { NativeFileCommit } from '../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../src/runtime/basic/file-publication.ts';
import { fileURLToPath } from 'node:url';
import { prepareEdit } from '../src/runtime/basic/edit-plan.ts';
import {
  readInputSchema,
  writeInputSchema,
  editInputSchema,
  shellInputSchema,
} from '../src/runtime/basic/basic-inputs.ts';

/**
 * Creates an isolated authorized workspace and removes only that owned fixture after all work has drained.
 */
async function withWorkspace(run) {
  const fixture = await mkdtemp(join(tmpdir(), 'octopus-basic-files-'));
  const root = join(fixture, 'workspace');
  const outside = join(fixture, 'workspace-other');
  await mkdir(root);
  await mkdir(outside);
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../dist/native/file-commit.node', import.meta.url))
  );
  const publication = await FilePublication.open(native, fixture);
  const reader = new BasicTools(publication);
  await reader.registerTask({
    taskId: 'task',
    ownerId: 'client',
    cwd: root,
    permissions: ['files.read'],
  });
  try {
    await run({ root, outside, reader });
  } finally {
    await reader.stopTask('client', 'task').catch((error) => {
      if (error.code !== 'TASK_NOT_FOUND') {
        throw error;
      }
    });
    await reader.close();
    await rm(fixture, { recursive: true, force: true });
  }
}

/**
 * Checks the stable public error code rather than an internal filesystem message.
 */
function hasCode(code) {
  return (error) => error.code === code;
}

test('Basic schemas reject legacy, unknown, taskless and mixed paging inputs', () => {
  assert.equal(readInputSchema.safeParse({ path: 'a.txt' }).success, false);
  assert.equal(readInputSchema.safeParse({ taskId: 'task', path: 'a.txt', roots: ['D:\\'] }).success, false);
  assert.equal(
    readInputSchema.safeParse({ taskId: 'task', path: 'a.txt', offset: 1, byteLimit: 4 }).success,
    false
  );
  assert.equal(readInputSchema.safeParse({ taskId: 'task', path: 'a.txt', limit: 2001 }).success, false);
  assert.equal(
    writeInputSchema.safeParse({
      taskId: 'task',
      path: 'a',
      content: '',
      idempotencyKey: 'key',
      expectedVersion: 'absent',
    }).success,
    true
  );
  assert.equal(
    writeInputSchema.safeParse({ taskId: 'task', path: 'a', content: '\ud800', idempotencyKey: 'key' })
      .success,
    false
  );
  assert.equal(
    editInputSchema.safeParse({
      taskId: 'task',
      path: 'a',
      oldText: 'a',
      newText: 'b',
      idempotencyKey: 'key',
    }).success,
    false
  );
  assert.equal(
    editInputSchema.safeParse({
      taskId: 'task',
      path: 'a',
      edits: [{ oldText: '', newText: 'b' }],
      idempotencyKey: 'key',
    }).success,
    false
  );
  assert.equal(
    shellInputSchema.parse({ taskId: 'task', command: 'echo hello', idempotencyKey: 'key' }).timeout,
    120
  );
  assert.equal(
    shellInputSchema.safeParse({ taskId: 'task', command: '中'.repeat(6000), idempotencyKey: 'key' }).success,
    false
  );
  assert.equal(
    shellInputSchema.safeParse({ taskId: 'task', command: 'a\0b', idempotencyKey: 'key' }).success,
    false
  );
});

test('read requires owner-bound authorization; grants are copied and shell permission cannot read files', async () => {
  await withWorkspace(async ({ root, reader }) => {
    await writeFile(join(root, 'a.txt'), 'abc');
    await assert.rejects(
      reader.read('other-client', { taskId: 'task', path: 'a.txt' }),
      hasCode('TASK_NOT_FOUND')
    );
    await assert.rejects(
      reader.read('client', { taskId: 'missing', path: 'a.txt' }),
      hasCode('TASK_NOT_FOUND')
    );
    const permissions = ['shell.execute'];
    await reader.registerTask({ taskId: 'shell', ownerId: 'client', cwd: root, permissions });
    permissions.push('files.read');
    await assert.rejects(
      reader.read('client', { taskId: 'shell', path: 'a.txt' }),
      hasCode('PERMISSION_DENIED')
    );
    await reader.stopTask('client', 'shell');
    await reader.registerTask({
      taskId: 'writer',
      ownerId: 'client',
      cwd: root,
      permissions: ['files.write'],
    });
    assert.equal((await reader.read('client', { taskId: 'writer', path: 'a.txt' })).text, 'abc');
    await reader.stopTask('client', 'writer');
  });
});

test('device file policy accepts cross-directory paths and rejects namespace, ADS, reserved and short-name aliases', async () => {
  await withWorkspace(async ({ root, outside, reader }) => {
    await writeFile(join(root, 'a.txt'), 'inside');
    await writeFile(join(outside, 'secret.txt'), 'outside');
    for (const path of [
      'a.txt:stream',
      'C:relative',
      '\\\\server\\share\\a',
      '\\\\?\\C:\\a',
      '/c/a',
      'https://a',
      'a.txt.',
      'a.txt ',
      'NUL.txt',
      'COM¹.log',
      '~\\a',
      'SHORT~1',
      '.octopus-executor-recovery-id\\a',
      'a\0b',
    ]) {
      await assert.rejects(reader.read('client', { taskId: 'task', path }), hasCode('PATH_REJECTED'), path);
    }
    assert.equal(
      (await reader.read('client', { taskId: 'task', path: '..\\workspace-other\\secret.txt' })).text,
      'outside'
    );
    assert.equal(
      (await reader.read('client', { taskId: 'task', path: join(outside, 'secret.txt') })).text,
      'outside'
    );
    assert.equal((await reader.read('client', { taskId: 'task', path: '.\\a.txt' })).text, 'inside');
    assert.equal((await reader.read('client', { taskId: 'task', path: join(root, 'a.txt') })).text, 'inside');
  });
});

test('real junctions are rejected even inside the workspace; ordinary hard links remain readable', async () => {
  await withWorkspace(async ({ root, outside, reader }) => {
    await writeFile(join(outside, 'secret.txt'), 'outside');
    await writeFile(join(root, 'a.txt'), 'inside');
    await symlink(outside, join(root, 'escape'), 'junction');
    await symlink(root, join(root, 'inside-link'), 'junction');
    await link(join(root, 'a.txt'), join(root, 'hard.txt'));
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'escape\\secret.txt' }),
      hasCode('PATH_REJECTED')
    );
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'inside-link\\a.txt' }),
      hasCode('PATH_REJECTED')
    );
    assert.equal((await reader.read('client', { taskId: 'task', path: 'hard.txt' })).text, 'inside');
    const another = reader;
    await assert.rejects(
      another.registerTask({
        taskId: 'x',
        ownerId: 'client',
        cwd: join(root, 'inside-link'),
        permissions: ['files.read'],
      }),
      hasCode('PATH_REJECTED')
    );
  });
});

test('version-bound paging rejects external changes and permits explicit fresh observation', async () => {
  await withWorkspace(async ({ root, reader }) => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'one\ntwo\nthree');
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'a.txt', offset: 2 }),
      hasCode('VERSION_REQUIRED')
    );
    const first = await reader.read('client', { taskId: 'task', path: 'a.txt', limit: 1 });
    assert.equal(first.text, 'one\n');
    const second = await reader.read('client', { taskId: 'task', path: 'a.txt', ...first.next });
    assert.equal(second.text, 'two\nthree');
    await writeFile(path, 'one\nnew\nthree');
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'a.txt', ...first.next }),
      hasCode('FILE_VERSION_CONFLICT')
    );
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'a.txt', offset: 2 }),
      hasCode('FILE_VERSION_CONFLICT')
    );
    const fresh = await reader.read('client', { taskId: 'task', path: 'a.txt' });
    assert.notEqual(fresh.version, first.version);
    assert.equal(
      (await reader.read('client', { taskId: 'task', path: 'a.txt', offset: 2 })).text,
      'new\nthree'
    );
  });
});

test('BOM and multibyte long-line pages reconstruct exact text and always advance', async () => {
  await withWorkspace(async ({ root, reader }) => {
    const text = '中😀'.repeat(9000) + '\r\nlast';
    await writeFile(join(root, 'a.txt'), '\ufeff' + text);
    let page = await reader.read('client', { taskId: 'task', path: 'a.txt' });
    assert.equal(page.byteOffset, 3);
    assert.ok(page.byteLength <= 50 * 1024);
    let combined = page.text;
    while (page.next) {
      const previousEnd = page.byteOffset + page.byteLength;
      page = await reader.read('client', { taskId: 'task', path: 'a.txt', ...page.next });
      assert.equal(page.byteOffset, previousEnd);
      assert.ok(page.byteLength > 0);
      combined += page.text;
    }
    assert.equal(combined, text);
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'a.txt', byteOffset: 1 }),
      hasCode('INVALID_BYTE_OFFSET')
    );
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'a.txt', byteOffset: 4 }),
      hasCode('INVALID_BYTE_OFFSET')
    );
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'a.txt', byteLimit: 2 }),
      hasCode('BYTE_LIMIT_TOO_SMALL')
    );
    assert.equal((await reader.read('client', { taskId: 'task', path: 'a.txt', byteLimit: 3 })).text, '中');
  });
});

test('default line limit, empty file and byte EOF are bounded and unambiguous', async () => {
  await withWorkspace(async ({ root, reader }) => {
    await writeFile(join(root, 'a.txt'), 'x\n'.repeat(2001));
    const page = await reader.read('client', { taskId: 'task', path: 'a.txt' });
    assert.equal(page.text, 'x\n'.repeat(2000));
    assert.equal(page.next.byteOffset, 4000);
    const eof = await reader.read('client', { taskId: 'task', path: 'a.txt', byteOffset: 4002 });
    assert.equal(eof.text, '');
    assert.equal(eof.next, null);
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'a.txt', byteOffset: 4003 }),
      hasCode('INVALID_BYTE_OFFSET')
    );
    await writeFile(join(root, 'empty.txt'), '');
    const empty = await reader.read('client', { taskId: 'task', path: 'empty.txt' });
    assert.equal(empty.totalBytes, 0);
    assert.equal(empty.truncated, false);
  });
});

test('invalid UTF-8, binary, directories and oversized files never produce text observations', async () => {
  await withWorkspace(async ({ root, reader }) => {
    await writeFile(join(root, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
    await writeFile(join(root, 'binary.txt'), Buffer.from([0x61, 0x00]));
    await mkdir(join(root, 'dir'));
    const handle = await open(join(root, 'large.txt'), 'w');
    await handle.truncate(16 * 1024 * 1024 + 1);
    await handle.close();
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'invalid.txt' }),
      hasCode('INVALID_UTF8')
    );
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'binary.txt' }),
      hasCode('UNSUPPORTED_FILE')
    );
    await assert.rejects(reader.read('client', { taskId: 'task', path: 'dir' }), hasCode('UNSUPPORTED_FILE'));
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'large.txt' }),
      hasCode('FILE_TOO_LARGE')
    );
    await writeFile(join(root, 'invalid.txt'), 'a\nb');
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'invalid.txt', offset: 2 }),
      hasCode('VERSION_REQUIRED')
    );
    await assert.rejects(
      reader.read('client', { taskId: 'task', path: 'missing.txt' }),
      (error) => error.code === 'FILE_READ_FAILED' && !error.message.includes(root)
    );
    assert.equal((await reader.read('client', { taskId: 'task', path: 'invalid.txt' })).text, 'a\nb');
  });
});

test('concurrent registration cannot replace authority; stopped tasks retain identity and reject new work', async () => {
  await withWorkspace(async ({ root, reader }) => {
    await writeFile(join(root, 'a.txt'), 'text');
    const grant = { taskId: 'new', ownerId: 'client', cwd: root, permissions: ['files.read'] };
    const registration = reader.registerTask(grant);
    await assert.rejects(reader.registerTask(grant), hasCode('TASK_LIMIT'));
    await assert.rejects(reader.stopTask('client', 'new'), hasCode('TASK_NOT_READY'));
    await registration;
    const calls = [
      reader.read('client', { taskId: 'new', path: 'a.txt' }),
      reader.read('client', { taskId: 'new', path: 'a.txt' }),
    ];
    const outcomes = Promise.allSettled(calls);
    const stopping = reader.stopTask('client', 'new');
    for (const result of await outcomes) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.code, 'TASK_STOPPED');
    }
    await stopping;
    await assert.rejects(reader.registerTask(grant), hasCode('TASK_LIMIT'));
    assert.equal(reader.taskStatus('client', 'new').state, 'stopped');
    await reader.registerTask({ ...grant, taskId: 'new-next' });
    assert.equal((await reader.read('client', { taskId: 'new-next', path: 'a.txt' })).text, 'text');
    await reader.stopTask('client', 'new-next');
  });
});

test('read bounds task queues and concurrent snapshots without poisoning later calls', async () => {
  await withWorkspace(async ({ root, reader }) => {
    await writeFile(join(root, 'a.txt'), 'text');
    const queued = Array.from({ length: 65 }, () => reader.read('client', { taskId: 'task', path: 'a.txt' }));
    const queueResults = await Promise.allSettled(queued);
    assert.equal(queueResults.filter((result) => result.status === 'fulfilled').length, 64);
    assert.equal(queueResults[64].reason.code, 'TASK_QUEUE_FULL');
    for (let index = 0; index < 5; index++) {
      await reader.registerTask({
        taskId: 'parallel-' + index,
        ownerId: 'client',
        cwd: root,
        permissions: ['files.read'],
      });
    }
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        reader.read('client', { taskId: 'parallel-' + index, path: 'a.txt' })
      )
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 4);
    assert.equal(results[4].reason.code, 'RUNTIME_BUSY');
    assert.equal((await reader.read('client', { taskId: 'parallel-4', path: 'a.txt' })).text, 'text');
    for (let index = 0; index < 5; index++) {
      await reader.stopTask('client', 'parallel-' + index);
    }
  });
});

test('edit uses the same original, preserves CRLF/BOM and reports unchanged replacements', () => {
  const original = Buffer.from('\ufeffalpha\r\nbeta\r\ngamma');
  const plan = prepareEdit(original, [
    { oldText: 'alpha\nbeta', newText: 'one\ntwo' },
    { oldText: 'gamma', newText: 'three' },
  ]);
  assert.equal(plan.content.toString(), '\ufeffone\r\ntwo\r\nthree');
  assert.equal(plan.replacements, 2);
  assert.equal(plan.changed, true);
  assert.equal(original.toString(), '\ufeffalpha\r\nbeta\r\ngamma');
  assert.equal(prepareEdit(original, [{ oldText: 'alpha\nbeta', newText: 'alpha\r\nbeta' }]).changed, false);
  assert.throws(
    () =>
      prepareEdit(Buffer.from('alpha'), [
        { oldText: 'alpha', newText: 'beta' },
        { oldText: 'beta', newText: 'gamma' },
      ]),
    hasCode('EDIT_NOT_FOUND')
  );
});

test('edit rejects ambiguity, overlapping matches, nested edits and mixed line endings', () => {
  assert.throws(
    () => prepareEdit(Buffer.from('banana'), [{ oldText: 'ana', newText: 'x' }]),
    hasCode('EDIT_AMBIGUOUS')
  );
  assert.throws(
    () =>
      prepareEdit(Buffer.from('abcdef'), [
        { oldText: 'abc', newText: 'x' },
        { oldText: 'bc', newText: 'y' },
      ]),
    hasCode('EDIT_OVERLAP')
  );
  assert.throws(
    () =>
      prepareEdit(Buffer.from('abcdef'), [
        { oldText: 'abc', newText: 'x' },
        { oldText: 'cde', newText: 'y' },
      ]),
    hasCode('EDIT_OVERLAP')
  );
  assert.throws(
    () => prepareEdit(Buffer.from('a\r\nb\nc'), [{ oldText: 'a', newText: 'x' }]),
    hasCode('UNSUPPORTED_LINE_ENDINGS')
  );
  assert.throws(
    () => prepareEdit(Buffer.from('a\rb'), [{ oldText: 'a', newText: 'x' }]),
    hasCode('UNSUPPORTED_LINE_ENDINGS')
  );
  assert.throws(
    () => prepareEdit(Buffer.from('é'), [{ oldText: 'e\u0301', newText: 'x' }]),
    hasCode('EDIT_NOT_FOUND')
  );
  assert.throws(
    () => prepareEdit(Buffer.from('abc'), [{ oldText: 'abc', newText: '\ud800' }]),
    hasCode('INVALID_TEXT')
  );
  assert.throws(
    () => prepareEdit(Buffer.from('abc'), [{ oldText: 'abc', newText: '\0' }]),
    hasCode('INVALID_EDIT')
  );
});

test('edit bounds UTF-8 replacements and final content, with no partial mutation', () => {
  const original = Buffer.from('prefix' + 'a'.repeat(9 * 1024 * 1024));
  assert.throws(
    () => prepareEdit(original, [{ oldText: 'prefix', newText: 'b'.repeat(8 * 1024 * 1024 - 6) }]),
    hasCode('EDIT_TOO_LARGE')
  );
  assert.throws(
    () => prepareEdit(Buffer.from('x'), [{ oldText: 'x', newText: '中'.repeat(3 * 1024 * 1024) }]),
    hasCode('INVALID_EDIT')
  );
  assert.equal(original.subarray(0, 6).toString(), 'prefix');
});
