/**
 * @author Codex
 * @description Verifies durable shell results, raw URI paging, expiry/revocation and real parent crash replay barriers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { testNodeResources } from '../fixtures/node-resources.mjs';
import { ShellExecutor } from '../../src/runtime/basic/shell-executor.ts';
import { once } from 'node:events';
import { nodeCommand } from '../fixtures/shell-command.mjs';
import { ShellHistory } from '../../src/runtime/basic/shell-history.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

const resources = fileURLToPath(new URL('../../dist/', import.meta.url));

/**
 * Opens real native backends on owned data, optionally recovering previous history in the same directory.
 */
async function openTools(root) {
  const native = new NativeFileCommit(join(resources, 'native', 'file-commit.node'));
  const publication = await FilePublication.open(native, root);
  const shell = await ShellExecutor.open(
    join(resources, 'native', 'process-supervisor.exe'),
    root,
    native,
    await testNodeResources(resources, native)
  );
  return { tools: new BasicTools(publication, shell), shell, native };
}

/**
 * Cleans only a test-owned absolute root after all admitted shell work has drained.
 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-shell-history-'));
  let current = await openTools(root);
  try {
    await current.tools.registerTask({
      ownerId: 'owner',
      taskId: 'task',
      cwd: root,
      permissions: ['shell.execute'],
    });
    await run({
      root,
      ...current,
      reopen: async () => {
        await current.tools.close();
        current = await openTools(root);
        return current;
      },
    });
  } finally {
    await current.tools.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-shell-history-')));
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

test('restart preserves exact shell results and source-owner output, refuses task reuse, and never repeats command effects', async () => {
  await fixture(async ({ root, tools, reopen }) => {
    const input = {
      taskId: 'task',
      command:
        "[IO.File]::AppendAllText([IO.Path]::Combine($PWD.Path, 'counter'), 'x'); [Console]::Write('sealed')",
      idempotencyKey: 'key',
    };
    const result = await tools.powershell('owner', input);
    const recovered = (await reopen()).tools;
    assert.deepEqual(await recovered.powershell('owner', input), result);
    assert.equal(await readFile(join(root, 'counter'), 'utf8'), 'x');
    await assert.rejects(recovered.powershell('other', input), { code: 'TASK_NOT_FOUND' });
    await assert.rejects(recovered.powershell('owner', { ...input, command: 'echo changed' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(
      recovered.registerTask({
        ownerId: 'owner',
        taskId: 'task',
        cwd: root,
        permissions: ['shell.execute'],
      }),
      { code: 'TASK_ID_REUSED' }
    );
    const page = await recovered.read('owner', {
      taskId: 'task',
      path: result.outputArtifact.uri + '/stdout',
    });
    assert.equal(page.encoding, 'base64');
    assert.equal(Buffer.from(page.text, 'base64').toString(), 'sealed');
    await assert.rejects(
      recovered.read('other', { taskId: 'task', path: result.outputArtifact.uri + '/stdout' }),
      { code: 'OUTPUT_NOT_FOUND' }
    );
  });
});

test('read URI paging retains arbitrary raw bytes, binds continuations to content version and caps serialized pages', async () => {
  await fixture(async ({ tools }) => {
    const result = await tools.powershell('owner', {
      taskId: 'task',
      command: nodeCommand(
        'process.stdout.write(Buffer.alloc(80000));process.stdout.write(Buffer.from([255]))'
      ),
      idempotencyKey: 'bytes',
    });
    let input = { taskId: 'task', path: result.outputArtifact.uri + '/stdout' };
    const pages = [];
    do {
      const page = await tools.read('owner', input);
      pages.push(Buffer.from(page.text, 'base64'));
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 51200);
      input = page.next ? { ...input, ...page.next } : null;
    } while (input);
    const raw = Buffer.concat(pages);
    assert.equal(raw.length, 80001);
    assert.equal(raw[80000], 255);
    await assert.rejects(
      tools.read('owner', { taskId: 'task', path: result.outputArtifact.uri + '/stdout', byteOffset: 1 }),
      { code: 'VERSION_REQUIRED' }
    );
    await assert.rejects(
      tools.read('owner', {
        taskId: 'task',
        path: result.outputArtifact.uri + '/stdout',
        expectedVersion: 'wrong',
      }),
      { code: 'FILE_VERSION_CONFLICT' }
    );
    await assert.rejects(
      tools.write('owner', {
        taskId: 'task',
        path: result.outputArtifact.uri,
        content: 'x',
        idempotencyKey: 'write',
      }),
      { code: 'PERMISSION_DENIED' }
    );
    await assert.rejects(
      tools.read('owner', { taskId: 'task', path: result.outputArtifact.uri + '/stdout', offset: 1 }),
      { code: 'INVALID_INPUT' }
    );
  });
});

test('revocation removes completed private material, keeps historical results and does not touch unrelated files', async () => {
  await fixture(async ({ root, tools, shell, reopen }) => {
    await writeFile(join(root, 'keep'), 'untouched');
    const input = { taskId: 'task', command: "[Console]::Write('sealed')", idempotencyKey: 'key' };
    const result = await tools.powershell('owner', input);
    await shell.revokeOutput('owner', 'task');
    await assert.rejects(
      tools.read('owner', { taskId: 'task', path: result.outputArtifact.uri + '/stdout' }),
      { code: 'OUTPUT_NOT_FOUND' }
    );
    const id = result.outputArtifact.uri.slice('executor-output://'.length);
    await assert.rejects(stat(join(root, 'shell', `.octopus-executor-recovery-${id}`)), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'keep'), 'utf8'), 'untouched');
    assert.deepEqual(await (await reopen()).tools.powershell('owner', input), result);
  });
});

test('expired history revokes access and is physically cleaned on startup while tombstones still prevent replay', async () => {
  await fixture(async ({ root, tools, reopen }) => {
    const input = { taskId: 'task', command: "[Console]::Write('old')", idempotencyKey: 'key' };
    const result = await tools.powershell('owner', input);
    await tools.close();
    const journal = join(root, 'shell');
    const file = (await readdir(journal)).find((name) => name.endsWith('.jsonl'));
    const records = (await readFile(join(journal, file), 'utf8')).trimEnd().split('\n').map(JSON.parse);
    for (const record of records) {
      record.created = Date.now() - 2 * 86400000;
      record.expires = record.created + 86400000;
    }
    // Keep immutable times identical across this deliberately expired fixture's complete valid history.
    const created = records[0].created;
    const expires = created + 86400000;
    for (const record of records) {
      record.created = created;
      record.expires = expires;
      if (record.result) {
        record.result.outputArtifact.expiresAt = new Date(expires).toISOString();
      }
    }
    await writeFile(join(journal, file), records.map(JSON.stringify).join('\n') + '\n');
    const recovered = (await reopen()).tools;
    await assert.rejects(
      recovered.read('owner', { taskId: 'task', path: result.outputArtifact.uri + '/stdout' }),
      { code: 'OUTPUT_NOT_FOUND' }
    );
    assert.equal((await recovered.powershell('owner', input)).output, result.output);
    assert.deepEqual(
      (await readdir(journal)).filter((name) => !name.endsWith('.jsonl')),
      []
    );
  });
});

test('cleanup refuses a junction inserted into private output and retains quota/evidence without following it', async () => {
  await fixture(async ({ root, tools, shell }) => {
    const result = await tools.powershell('owner', {
      taskId: 'task',
      command: "[Console]::Write('x')",
      idempotencyKey: 'key',
    });
    const id = result.outputArtifact.uri.slice('executor-output://'.length);
    const directory = join(root, 'shell', `.octopus-executor-recovery-${id}`);
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'keep'), 'safe');
    await symlink(outside, join(directory, 'junction'), 'junction');
    await shell.revokeOutput('owner', 'task');
    assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'safe');
    assert.ok((await stat(directory)).isDirectory());
    await rm(join(directory, 'junction'));
    await shell.cleanup();
    await assert.rejects(stat(directory), { code: 'ENOENT' });
  });
});

test('malformed and partial shell journals fail closed and release ownership after rejected open', async () => {
  await fixture(async ({ root, tools, native, reopen }) => {
    await tools.powershell('owner', { taskId: 'task', command: '$null = 1', idempotencyKey: 'key' });
    await tools.close();
    const journal = join(root, 'shell');
    const name = (await readdir(journal)).find((item) => item.endsWith('.jsonl'));
    const path = join(journal, name);
    const original = await readFile(path);
    await writeFile(path, original.subarray(0, original.length - 1));
    await assert.rejects(ShellHistory.open(native, root), { code: 'SHELL_HISTORY_INVALID' });
    await writeFile(path, original);
    const old = original
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map(JSON.parse)
      .map((record) => {
        delete record.schemaVersion;
        delete record.shell;
        return record;
      });
    const oldBytes = Buffer.from(old.map(JSON.stringify).join('\n') + '\n');
    await writeFile(path, oldBytes);
    await assert.rejects(ShellHistory.open(native, root), { code: 'SHELL_HISTORY_INVALID' });
    assert.deepEqual(await readFile(path), oldBytes);
    await writeFile(path, original);
    await reopen();
  });
});

test('actual Runtime-like crash retains dispatched replay barrier and never repeats the observed command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-history-crash-'));
  let parent;
  let recovered;
  try {
    parent = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('../fixtures/shell-runtime.mjs', import.meta.url)),
        root,
        resources,
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    const [ready] = await once(parent.stdout, 'data', { signal: AbortSignal.timeout(30000) });
    assert.equal(ready.toString(), 'ready\n');
    let started = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        started = (await readFile(join(root, 'counter'), 'utf8')) === 'x';
        if (started) {
          break;
        }
      } catch {
        /* Wait only for the owned fixture's marker. */
      }
      await new Promise((accept) => setTimeout(accept, 25));
    }
    assert.ok(started);
    const exit = new Promise((accept) => parent.once('exit', accept));
    parent.kill();
    await exit;
    recovered = await openTools(root);
    await assert.rejects(
      recovered.tools.powershell('owner', {
        taskId: 'crash',
        command:
          "[IO.File]::AppendAllText([IO.Path]::Combine($PWD.Path, 'counter'), 'x'); Start-Sleep -Seconds 30",
        idempotencyKey: 'crash-key',
      }),
      { code: 'SHELL_RESULT_UNKNOWN' }
    );
    assert.equal(await readFile(join(root, 'counter'), 'utf8'), 'x');
    await assert.rejects(
      recovered.tools.registerTask({
        ownerId: 'owner',
        taskId: 'crash',
        cwd: root,
        permissions: ['shell.execute'],
      }),
      { code: 'TASK_ID_REUSED' }
    );
  } finally {
    parent?.kill();
    await recovered?.tools.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-history-crash-')));
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

test('uncertain reservations survive restart and continue to enforce the combined output quota', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-shell-quota-'));
  const native = new NativeFileCommit(join(resources, 'native', 'file-commit.node'));
  let history = await ShellHistory.open(native, root);
  try {
    for (let index = 0; index < 4; index++) {
      await history.admit({
        ownerId: 'owner',
        taskId: 'task',
        idempotencyKey: String(index),
        fingerprint: '0'.repeat(64),
      });
    }
    await history.close();
    history = await ShellHistory.open(native, root);
    assert.throws(() => history.lookup('owner', 'task', '0', '0'.repeat(64)), { code: 'SHELL_NOT_STARTED' });
    await assert.rejects(
      history.admit({ ownerId: 'owner', taskId: 'new', idempotencyKey: 'new', fingerprint: '0'.repeat(64) }),
      { code: 'SHELL_OUTPUT_QUOTA' }
    );
  } finally {
    await history.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-shell-quota-')));
    await rm(root, { recursive: true, force: true });
  }
});
