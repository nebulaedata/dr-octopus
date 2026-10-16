/**
 * @author Codex
 * @description Verifies actual pinned search binaries, native scope reads, bounded results and shared task lifecycle.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { SearchTools } from '../../src/runtime/basic/search-tools.ts';
import { SearchProcess } from '../../src/runtime/basic/search-process.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';

const binary = fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url));
const supervisor = fileURLToPath(new URL('../../dist/native/process-supervisor.exe', import.meta.url));
const resources = fileURLToPath(new URL('../../dist/resources/search', import.meta.url));

/**
 * Owns every fixture path and drains all tool operations before removing the temporary root.
 */
async function fixture(run, Native = NativeFileCommit) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-search-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const native = new Native(binary);
  const publication = await FilePublication.open(native, root);
  const search = new SearchTools(supervisor, resources, root, native);
  const tools = new BasicTools(publication, undefined, search);
  try {
    await search.verify();
    for (const [taskId, permissions] of [
      ['reader', ['files.read']],
      ['writer', ['files.write']],
      ['shell', ['shell.execute']],
    ]) {
      await tools.registerTask({
        taskId,
        permissions,
        ownerId: 'client',
        cwd: workspace,
      });
    }
    await run({ root, workspace, tools, native });
  } finally {
    await tools.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('search tools require existing owner-bound file grants and strict finite inputs', async () => {
  await fixture(async ({ tools, workspace, root }) => {
    await writeFile(join(workspace, 'a.txt'), 'needle');
    const other = join(root, 'other');
    await mkdir(other);
    await writeFile(join(other, 'a.txt'), 'needle');
    for (const [method, extra] of [
      ['ls', {}],
      ['find', { pattern: '*.txt' }],
      ['grep', { pattern: 'needle' }],
    ]) {
      await assert.rejects(tools[method]('other', { taskId: 'reader', ...extra }), {
        code: 'TASK_NOT_FOUND',
      });
      await assert.rejects(tools[method]('client', { taskId: 'shell', ...extra }), {
        code: 'PERMISSION_DENIED',
      });
      await assert.rejects(tools[method]('client', { taskId: 'reader', roots: [workspace], ...extra }), {
        code: 'INVALID_INPUT',
      });
      assert.equal(
        (await tools[method]('client', { taskId: 'reader', path: other, ...extra })).entries.length,
        1
      );
      assert.equal(
        (await tools[method]('client', { taskId: 'reader', path: '..\\other', ...extra })).entries.length,
        1
      );
      await assert.rejects(
        tools[method]('client', { taskId: 'reader', path: '\\\\server\\share', ...extra }),
        { code: 'PATH_REJECTED' }
      );
      await assert.rejects(tools[method]('client', { taskId: 'reader', limit: 1001, ...extra }), {
        code: 'INVALID_INPUT',
      });
    }
    assert.equal((await tools.find('client', { taskId: 'writer', pattern: '*.txt' })).entries.length, 1);
  });
});

test('find respects workspace ignores, explicit hidden opt-in and reserved directories', async () => {
  await fixture(async ({ workspace, tools }) => {
    await mkdir(join(workspace, 'src'));
    await mkdir(join(workspace, '.octopus-executor-recovery-secret'));
    await writeFile(join(workspace, 'src', '中文😀.txt'), 'hello');
    await writeFile(join(workspace, '.hidden.txt'), 'hidden');
    await writeFile(join(workspace, 'ignored.txt'), 'ignored');
    await writeFile(join(workspace, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(workspace, '.octopus-executor-recovery-secret', 'secret.txt'), 'secret');
    const found = await tools.find('client', { taskId: 'reader', pattern: '*.txt' });
    assert.deepEqual(
      found.entries.map((entry) => entry.path),
      ['src\\中文😀.txt']
    );
    const all = await tools.find('client', {
      taskId: 'reader',
      pattern: '*.txt',
      hidden: true,
      ignore: false,
    });
    assert.equal(all.entries.length, 3);
    assert.ok(!JSON.stringify(all).includes('secret'));
    const scoped = await tools.find('client', { taskId: 'reader', path: 'src', pattern: '*.txt' });
    assert.equal(scoped.entries[0].path, '中文😀.txt');
    assert.equal(
      (await tools.find('client', { taskId: 'reader', pattern: 'src/*.txt' })).entries[0].path,
      'src\\中文😀.txt'
    );
  });
});

test('grep supports Rust regex, literal, case, context, glob and accurate no-match errors', async () => {
  await fixture(async ({ workspace, tools, root }) => {
    await writeFile(join(workspace, 'a.txt'), 'before\r\nNeedle 😀\r\nafter\r\na+b\n');
    await writeFile(join(workspace, 'b.js'), 'Needle other');
    const matches = await tools.grep('client', {
      taskId: 'reader',
      pattern: '^needle',
      ignoreCase: true,
      context: 1,
      glob: '*.txt',
    });
    assert.equal(matches.status, 'matches');
    assert.deepEqual(
      matches.entries.map((entry) => [entry.kind, entry.line]),
      [
        ['context', 1],
        ['match', 2],
        ['context', 3],
      ]
    );
    assert.equal(matches.entries[1].text, 'Needle 😀');
    const literal = await tools.grep('client', { taskId: 'reader', pattern: 'a+b', literal: true });
    assert.equal(literal.entries[0].line, 4);
    assert.equal((await tools.grep('client', { taskId: 'reader', pattern: 'missing' })).status, 'no_match');
    await assert.rejects(tools.grep('client', { taskId: 'reader', pattern: '[' }), {
      code: 'INVALID_PATTERN',
    });
    await assert.rejects(tools.grep('client', { taskId: 'reader', pattern: '[', glob: '*.none' }), {
      code: 'INVALID_PATTERN',
    });
    assert.ok(!(await readdir(root)).some((name) => name.startsWith('.octopus-executor-recovery-search-')));
    await tools.grep('client', { taskId: 'writer', pattern: 'Needle' });
    await assert.rejects(
      tools.write('client', {
        taskId: 'writer',
        path: 'a.txt',
        content: 'replace',
        idempotencyKey: 'search-not-observation',
      }),
      { code: 'EXPECTED_VERSION_REQUIRED' }
    );
  });
});

test('ls lists only direct children, labels junctions and never reveals target children', async () => {
  await fixture(async ({ root, workspace, tools }) => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(workspace, 'linked'), 'junction');
    await mkdir(join(workspace, 'nested'));
    await writeFile(join(workspace, 'nested', 'child.txt'), 'child');
    await writeFile(join(workspace, 'visible.txt'), 'visible');
    const listed = await tools.ls('client', { taskId: 'reader' });
    assert.equal(listed.entries.find((entry) => entry.path === 'linked').type, 'reparse');
    assert.ok(!JSON.stringify(listed).includes('secret.txt'));
    assert.ok(!JSON.stringify(listed).includes('child.txt'));
    assert.ok(
      !(await tools.find('client', { taskId: 'reader', pattern: '*.txt', hidden: true })).entries.some(
        (entry) => entry.path.includes('secret')
      )
    );
    await assert.rejects(tools.grep('client', { taskId: 'reader', path: 'linked', pattern: 'secret' }), {
      code: 'PATH_REJECTED',
    });
  });
});

test('native snapshots reject junction replacement after JavaScript path validation', async () => {
  let replaced = false;
  class RacingNative extends NativeFileCommit {
    /**
     * Replaces a previously validated ancestor before the actual guarded native read.
     */
    async readSnapshot(path) {
      if (!replaced) {
        replaced = true;
        const parent = join(path, '..');
        await rename(parent, parent + '-saved');
        await symlink(join(parent, '..', '..', 'outside'), parent, 'junction');
      }
      return super.readSnapshot(path);
    }
  }
  await fixture(async ({ root, workspace, tools }) => {
    await mkdir(join(root, 'outside'));
    await writeFile(join(root, 'outside', 'a.txt'), 'outside-secret');
    await mkdir(join(workspace, 'inside'));
    await writeFile(join(workspace, 'inside', 'a.txt'), 'inside');
    await assert.rejects(tools.grep('client', { taskId: 'reader', pattern: 'secret' }), {
      code: 'SEARCH_PATH_REJECTED',
    });
    assert.equal(await readFile(join(root, 'outside', 'a.txt'), 'utf8'), 'outside-secret');
  }, RacingNative);
});

test('search output is capped after JSON escaping and binary/oversized inputs are explicit partial results', async () => {
  await fixture(async ({ workspace, tools }) => {
    await writeFile(
      join(workspace, 'many.txt'),
      Array.from({ length: 1200 }, () => 'needle\\\t"'.repeat(40)).join('\n')
    );
    const found = await tools.grep('client', { taskId: 'reader', pattern: 'needle' });
    assert.equal(found.truncated, true);
    assert.equal(found.status, 'partial');
    assert.ok(Buffer.byteLength(JSON.stringify(found)) <= 50 * 1024);
    const limited = await tools.grep('client', { taskId: 'reader', pattern: 'needle', limit: 2 });
    assert.equal(limited.entries.length, 2);
    assert.equal(limited.truncated, true);
    await writeFile(join(workspace, 'binary.bin'), Buffer.from([0, 255, 1]));
    await writeFile(join(workspace, 'large.txt'), Buffer.alloc(16 * 1024 * 1024 + 1, 97));
    const skipped = await tools.grep('client', { taskId: 'reader', pattern: 'absent' });
    assert.equal(skipped.skippedFiles, 2);
    assert.equal(skipped.status, 'partial');
  });
});

test('stop closes readonly admission, cancels active search and rejects queued calls before dispatch', async () => {
  let entered;
  const started = new Promise((accept) => {
    entered = accept;
  });
  let release;
  const gate = new Promise((accept) => {
    release = accept;
  });
  class PausedNative extends NativeFileCommit {
    /**
     * Holds an actual native snapshot to exercise independent task stop while its queue is occupied.
     */
    async readSnapshot(path) {
      entered();
      await gate;
      return super.readSnapshot(path);
    }
  }
  await fixture(async ({ workspace, tools }) => {
    await writeFile(join(workspace, 'a.txt'), 'needle');
    const pending = tools.grep('client', { taskId: 'reader', pattern: 'needle' });
    await started;
    const queued = tools.ls('client', { taskId: 'reader' });
    const settled = Promise.allSettled([pending, queued]);
    const stopping = tools.stopTask('client', 'reader');
    release();
    await stopping;
    const outcomes = await settled;
    assert.equal(outcomes[0].reason.code, 'SEARCH_CANCELLED');
    assert.equal(outcomes[1].reason.code, 'TASK_STOPPED');
    assert.equal(tools.taskStatus('client', 'reader').queued, 0);
  }, PausedNative);
});

test('private direct rg Jobs confirm timeout, cancellation and hard output caps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-search-process-'));
  const process = new SearchProcess(supervisor, resources);
  try {
    await writeFile(join(root, 'a.txt'), 'needle\n'.repeat(500000));
    const timeout = await process
      .run('rg', ['--json', '--regexp', 'needle', '.'], root, new AbortController().signal, 1)
      .catch((error) => error);
    assert.equal(timeout.code, 'SEARCH_TIMEOUT');
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        const outcome = await process
          .run('rg', ['--json', '--regexp', 'needle', '.'], root, new AbortController().signal, 1)
          .catch((error) => error);
        assert.equal(
          outcome.code,
          'SEARCH_TIMEOUT',
          'Short-lived Jobs must close control admission without a blocked reader.'
        );
      })
    );
    const capped = await process.run(
      'rg',
      ['--json', '--regexp', 'needle', '.'],
      root,
      new AbortController().signal,
      30000
    );
    assert.equal(capped.terminal.reason, 'output_limit');
    assert.equal(capped.terminal.quiescent, true);
    assert.ok(capped.stdout.length + capped.stderr.length <= 2 * 1024 * 1024);
    const controller = new AbortController();
    const pending = process.run('rg', ['--json', '--regexp', 'needle', '.'], root, controller.signal, 30000);
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(pending, (error) => ['SEARCH_CANCELLED', 'TASK_STOPPED'].includes(error.code));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('search never falls back to PATH and prior private snapshots block startup without automatic deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-search-assets-'));
  const native = new NativeFileCommit(binary);
  try {
    await assert.rejects(new SearchProcess(supervisor, root).verify());
    const directory = join(root, '.octopus-executor-recovery-search-orphan');
    assert.equal((await native.createRecovery(directory)).ok, true);
    await writeFile(join(directory, '0.txt'), 'retained');
    const search = new SearchTools(supervisor, resources, root, native);
    await assert.rejects(search.verify(), { code: 'SEARCH_RECOVERY_REQUIRED' });
    assert.equal(await readFile(join(directory, '0.txt'), 'utf8'), 'retained');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('long match lines mark text truncation while remaining valid UTF-8 and bounded JSON', async () => {
  await fixture(async ({ workspace, tools }) => {
    await writeFile(join(workspace, 'a.txt'), 'needle' + '😀'.repeat(10000));
    const matched = await tools.grep('client', { taskId: 'reader', pattern: 'needle' });
    assert.equal(matched.entries[0].textTruncated, true);
    assert.equal(matched.truncated, true);
    assert.equal(matched.status, 'partial');
    assert.equal(matched.entries[0].text.isWellFormed(), true);
    assert.ok(Buffer.byteLength(JSON.stringify(matched)) <= 50 * 1024);
  });
});

test('leading dashes and shell metacharacters remain plain search arguments', async () => {
  await fixture(async ({ workspace, tools }) => {
    await writeFile(join(workspace, '--exec space.txt'), '--exec ; echo $HOME & "quoted"');
    const found = await tools.find('client', { taskId: 'reader', pattern: '--exec*.txt' });
    assert.equal(found.entries[0].path, '--exec space.txt');
    const matched = await tools.grep('client', {
      taskId: 'reader',
      pattern: '--exec ; echo $HOME & "quoted"',
      literal: true,
    });
    assert.equal(matched.entries.length, 1);
    assert.equal(matched.entries[0].text, '--exec ; echo $HOME & "quoted"');
    assert.deepEqual(await readdir(workspace), ['--exec space.txt']);
  });
});
