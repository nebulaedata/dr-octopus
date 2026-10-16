/**
 * @author Codex
 * @description Verifies real NTFS publication, recovery evidence and external-race outcomes in owned fixtures.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, link, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { readTextSnapshot } from '../../src/runtime/basic/text-file.ts';

const binary = resolve(fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url)));

/**
 * Creates only disposable NTFS files and closes publication ownership before deleting them.
 */
async function fixture(run, Native = NativeFileCommit) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-native-files-'));
  const userData = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(userData);
  await mkdir(workspace);
  const native = new Native(binary);
  let publisher;
  try {
    publisher = await FilePublication.open(native, userData);
    await run({ root, userData, workspace, native, publisher });
  } finally {
    if (publisher) {
      await publisher.close();
    }
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Creates an internal authorized-fixture request, not a public tool call.
 */
function request(target, content, expectedVersion = 'absent', idempotencyKey = 'operation') {
  return {
    target,
    content: Buffer.from(content),
    expectedVersion,
    idempotencyKey,
    ownerId: 'client',
    taskId: 'task',
  };
}

test('native publication preserves the actual old file in a private backup and restores idempotency after restart', async () => {
  await fixture(async ({ workspace, userData, native, publisher }) => {
    await assert.rejects(FilePublication.open(native, userData), { code: 'RECOVERY_IN_USE' });
    const target = join(workspace, 'a.txt');
    await writeFile(target, 'original');
    const version = (await readTextSnapshot(target)).version;
    const input = request(target, 'updated', version);
    const [first, duplicate] = await Promise.all([publisher.publish(input), publisher.publish(input)]);
    assert.deepEqual(duplicate, first);
    assert.equal(first.status, 'applied');
    assert.equal(await readFile(target, 'utf8'), 'updated');
    const backup = join(workspace, '.octopus-executor-recovery-' + first.recoveryId, 'previous.txt');
    assert.equal(await readFile(backup, 'utf8'), 'original');
    assert.equal((await native.inspect(backup)).privateAcl, true);
    first.status = 'uncertain';
    assert.equal((await publisher.publish(input)).status, 'applied');
    await assert.rejects(publisher.publish({ ...input, content: Buffer.from('different') }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await publisher.close();
    const reopened = await FilePublication.open(native, userData);
    try {
      assert.deepEqual(await reopened.publish(input), duplicate);
    } finally {
      await reopened.close();
    }
  });
});

test('new file uses absent/no-clobber and stale versions or no-change requests never overwrite', async () => {
  await fixture(async ({ workspace, publisher }) => {
    const target = join(workspace, 'new.txt');
    const created = await publisher.publish(request(target, 'new'));
    assert.equal(created.status, 'applied');
    await assert.rejects(publisher.publish(request(target, 'overwrite', 'absent', 'next')), {
      code: 'FILE_VERSION_CONFLICT',
    });
    await assert.rejects(publisher.publish(request(target, 'overwrite', '0'.repeat(64), 'stale')), {
      code: 'FILE_VERSION_CONFLICT',
    });
    const unchanged = await publisher.publish(request(target, 'new', created.version, 'same'));
    assert.equal(unchanged.status, 'no_change');
    assert.equal(unchanged.version, created.version);
    assert.equal(await readFile(target, 'utf8'), 'new');
  });
});

test('native boundary rejects hard links, junctions and wrong identities without entering publication', async () => {
  await fixture(async ({ workspace, root, native }) => {
    const target = join(workspace, 'a.txt');
    await writeFile(target, 'old');
    await link(target, join(workspace, 'hard.txt'));
    const recovery = join(workspace, '.octopus-executor-recovery-native-check');
    assert.equal((await native.createRecovery(recovery)).ok, true);
    assert.equal((await native.createRecovery(recovery)).ok, false);
    const temp = join(recovery, 'proposed.txt');
    await writeFile(temp, 'new');
    const targetInfo = await native.inspect(target);
    const parentInfo = await native.inspect(workspace);
    const tempInfo = await native.inspect(temp);
    const args = {
      target,
      temp,
      backup: join(recovery, 'previous.txt'),
      targetIdentity: targetInfo.identity,
      parentIdentity: parentInfo.identity,
      tempIdentity: tempInfo.identity,
    };
    const refused = await native.commit(args);
    assert.equal(refused.ok, false);
    assert.equal(refused.started, false);
    const noClobber = await native.commit({ ...args, targetIdentity: 'absent' });
    assert.equal(noClobber.ok, false);
    assert.equal(noClobber.nativeCode, 183);
    assert.equal(noClobber.started, false);
    const badParent = await native.commit({ ...args, targetIdentity: 'absent', parentIdentity: 'wrong' });
    assert.equal(badParent.started, false);
    await symlink(workspace, join(root, 'link'), 'junction');
    assert.equal((await native.inspect(join(root, 'link', 'a.txt'))).ok, false);
    assert.equal(await readFile(target, 'utf8'), 'old');
    assert.equal(await readFile(temp, 'utf8'), 'new');
  });
});

test('real external write between version checking and replacement is preserved and reported as a post-commit conflict', async () => {
  class RacingNative extends NativeFileCommit {
    /**
     * Injects an ordinary same-identity external write immediately before the real native boundary.
     */
    async commit(input) {
      await writeFile(input.target, 'external-update');
      return super.commit(input);
    }
  }
  await fixture(async ({ workspace, publisher }) => {
    const target = join(workspace, 'a.txt');
    await writeFile(target, 'old');
    const version = (await readTextSnapshot(target)).version;
    const result = await publisher.publish(request(target, 'ours', version));
    assert.equal(result.status, 'conflict_after_commit');
    assert.equal(await readFile(target, 'utf8'), 'ours');
    assert.equal(
      await readFile(
        join(workspace, '.octopus-executor-recovery-' + result.recoveryId, 'previous.txt'),
        'utf8'
      ),
      'external-update'
    );
    await assert.rejects(
      publisher.publish(request(target, 'again', (await readTextSnapshot(target)).version, 'again')),
      { code: 'FILE_RECOVERY_REQUIRED' }
    );
  }, RacingNative);
});

test('restart verifies a commit_started history from actual target and backup without repeating the native call', async () => {
  await fixture(async ({ workspace, userData, native, publisher }) => {
    const target = join(workspace, 'a.txt');
    await writeFile(target, 'old');
    const input = request(target, 'new', (await readTextSnapshot(target)).version);
    const result = await publisher.publish(input);
    await publisher.close();
    const journal = join(userData, 'file-operations', result.recoveryId + '.jsonl');
    const history = (await readFile(journal, 'utf8')).trimEnd().split('\n');
    await writeFile(journal, history.slice(0, 2).join('\n') + '\n');
    const recovered = await FilePublication.open(native, userData);
    try {
      assert.equal((await recovered.publish(input)).status, 'applied');
      assert.equal(await readFile(target, 'utf8'), 'new');
      assert.equal(recovered.getBlockedTargets().length, 0);
    } finally {
      await recovered.close();
    }
  });
});

test('restart retains uncertain outcomes and rejects corrupt or incomplete journals', async () => {
  class FailingNative extends NativeFileCommit {
    /**
     * Simulates transport/native failure after commit_started was flushed, with no false unchanged guarantee.
     */
    async commit() {
      throw new Error('injected backend failure');
    }
  }
  await fixture(async ({ workspace, userData, publisher }) => {
    const target = join(workspace, 'a.txt');
    await writeFile(target, 'old');
    const input = request(target, 'new', (await readTextSnapshot(target)).version);
    const result = await publisher.publish(input);
    assert.equal(result.status, 'uncertain');
    await publisher.close();
    const native = new NativeFileCommit(binary);
    const recovered = await FilePublication.open(native, userData);
    try {
      assert.equal((await recovered.publish(input)).status, 'uncertain');
      assert.equal(recovered.getBlockedTargets().length, 1);
      assert.equal(await readFile(target, 'utf8'), 'old');
    } finally {
      await recovered.close();
    }
    const journalDir = join(userData, 'file-operations');
    const [name] = await readdir(journalDir);
    await writeFile(join(journalDir, name), '{incomplete');
    await assert.rejects(FilePublication.open(native, userData), { code: 'RECOVERY_INVALID' });
  }, FailingNative);
});

test('prepared restart confirms not-applied, while completed JSON with invalid phase ordering fails closed', async () => {
  class FailingNative extends NativeFileCommit {
    /**
     * Leaves real prepared materials while simulating a failed native dispatch.
     */
    async commit() {
      throw new Error('injected dispatch failure');
    }
  }
  await fixture(async ({ workspace, userData, publisher }) => {
    const target = join(workspace, 'a.txt');
    await writeFile(target, 'old');
    const input = request(target, 'new', (await readTextSnapshot(target)).version);
    const result = await publisher.publish(input);
    await publisher.close();
    const journal = join(userData, 'file-operations', result.recoveryId + '.jsonl');
    const history = (await readFile(journal, 'utf8')).trimEnd().split('\n');
    await writeFile(journal, history[0] + '\n');
    const native = new NativeFileCommit(binary);
    const recovered = await FilePublication.open(native, userData);
    try {
      assert.equal((await recovered.publish(input)).status, 'not_applied');
      assert.equal(await readFile(target, 'utf8'), 'old');
      assert.equal(recovered.getBlockedTargets().length, 0);
    } finally {
      await recovered.close();
    }
    await writeFile(journal, history[1] + '\n');
    await assert.rejects(FilePublication.open(native, userData), { code: 'RECOVERY_INVALID' });
  }, FailingNative);
});
