/**
 * @author Codex
 * @description Verifies private project directories, file-tool exclusion and independently disposable runtime scratch space.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { createRuntimeTemporary } from '../../src/runtime/basic/runtime-temporary.ts';
import {
  protectExecutorStorage,
  resolveReadableFile,
  resolveMutationFile,
  resolveLocalDirectory,
} from '../../src/runtime/basic/file-policy.ts';
import { SearchTools } from '../../src/runtime/basic/search-tools.ts';

test('project storage is private and excluded by read, write, ls, find and grep even with ignores disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-project-policy-'));
  const resources = fileURLToPath(new URL('../../dist', import.meta.url));
  const native = new NativeFileCommit(join(resources, 'native/file-commit.node'));
  const project = join(root, 'project');
  let temporary;
  try {
    await mkdir(project);
    protectExecutorStorage(project);
    for (const name of [
      'device',
      'connections',
      'tasks',
      'browser',
      'file-operations',
      'shell',
      'transfers',
      'settings-recovery',
    ]) {
      const result = await native.createRecovery(join(project, name));
      assert.equal(result.ok, true);
      assert.equal(result.privateAcl, true);
    }
    await writeFile(join(project, 'connections', 'secret.txt'), 'private-needle');
    await writeFile(join(root, 'public.txt'), 'public-needle');
    for (const path of [
      join(project, 'connections', 'secret.txt'),
      join(root, 'elsewhere', '..', 'project', 'connections', 'secret.txt'),
    ]) {
      await assert.rejects(resolveReadableFile(path, root), { code: 'PATH_REJECTED' });
      await assert.rejects(resolveMutationFile(path, root), { code: 'PATH_REJECTED' });
    }
    await assert.rejects(resolveLocalDirectory(project), { code: 'PATH_REJECTED' });
    temporary = await createRuntimeTemporary(native);
    assert.equal(dirname(temporary.root), tmpdir());
    assert.equal((await native.inspect(temporary.root)).privateAcl, true);
    protectExecutorStorage(temporary.root);
    const search = new SearchTools(
      join(resources, 'native/process-supervisor.exe'),
      join(resources, 'resources/search'),
      temporary.root,
      native
    );
    await search.verify();
    const scope = { cwd: root, signal: new AbortController().signal };
    const listed = await search.ls({ path: root, hidden: true, limit: 100 }, scope);
    assert.equal(
      listed.entries.some((entry) => entry.path === 'project'),
      false
    );
    const found = await search.find(
      { path: root, pattern: '*', hidden: true, ignore: false, limit: 100 },
      scope
    );
    assert.deepEqual(
      found.entries.map((entry) => entry.path),
      ['public.txt']
    );
    const grepped = await search.grep(
      {
        path: root,
        pattern: 'private-needle',
        glob: '*',
        hidden: true,
        ignore: false,
        limit: 100,
        literal: true,
        context: 0,
      },
      scope
    );
    assert.deepEqual(grepped.entries, []);
    assert.deepEqual(await readdir(temporary.root), []);
  } finally {
    await temporary?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a new runtime scratch directory is independent of retained disposable material', async () => {
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const first = await createRuntimeTemporary(native);
  const second = await createRuntimeTemporary(native);
  try {
    assert.notEqual(first.root, second.root);
    await writeFile(join(first.root, 'unexpected'), 'retain');
    await first.close();
    assert.deepEqual(await readdir(first.root), ['unexpected']);
    await second.close();
    assert.equal((await native.inspect(second.root)).ok, false);
  } finally {
    for (const path of [first.root, second.root]) {
      await rm(path, { recursive: true, force: true });
    }
  }
});
