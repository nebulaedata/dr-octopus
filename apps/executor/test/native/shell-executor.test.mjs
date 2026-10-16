/**
 * @author Codex
 * @description Exercises system PowerShell, Job cleanup, output framing and shared task admission.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { nodeCommand, psLiteral } from '../fixtures/shell-command.mjs';
import { selectShellPlatform } from '../../src/runtime/basic/shell-platform.ts';
import { testNodeResources } from '../fixtures/node-resources.mjs';
import { ShellExecutor } from '../../src/runtime/basic/shell-executor.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

const resources = fileURLToPath(new URL('../../dist/', import.meta.url));

/**
 * Uses only a fresh owned workspace/data directory and closes tasks before removing that directory.
 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-powershell-'));
  const workspace = join(root, '中文 workspace');
  await mkdir(workspace);
  const native = new NativeFileCommit(join(resources, 'native', 'file-commit.node'));
  const publication = await FilePublication.open(native, root);
  const shell = await ShellExecutor.open(
    join(resources, 'native', 'process-supervisor.exe'),
    root,
    native,
    await testNodeResources(resources, native)
  );
  const tools = new BasicTools(publication, shell);
  try {
    await tools.registerTask({
      taskId: 'task',
      ownerId: 'owner',
      cwd: workspace,
      permissions: ['files.write', 'shell.execute'],
    });
    await run({ tools, shell, workspace, root });
  } finally {
    await tools.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-powershell-')));
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Decodes production read URI pages, supplying an explicit content version for continuation bytes.
 */
async function rawOutput(tools, owner, taskId, uri, stream, offset, limit) {
  const request = { taskId, path: uri + '/' + stream, byteOffset: offset, byteLimit: limit };
  if (offset > 0) {
    request.expectedVersion = (await tools.read(owner, { taskId, path: request.path, byteLimit: 1 })).version;
  }
  const page = await tools.read(owner, request);
  return { bytes: Buffer.from(page.text, 'base64'), totalBytes: page.totalBytes, version: page.version };
}
test('system PowerShell preserves Unicode quoting, separates raw streams, ignores ambient shell startup and caches stopped results', async () => {
  await fixture(async ({ tools }) => {
    const input = {
      taskId: 'task',
      command: `[Console]::Write('中文 "quoted" \\ text'); [Console]::Error.Write('error'); if (-not $env:BASH_ENV) { [Console]::Write('unset') }`,
      idempotencyKey: 'key',
    };
    const result = await tools.powershell('owner', input);
    assert.equal(result.terminationReason, 'completed');
    assert.equal(result.exitCode, 0);
    const out = await rawOutput(tools, 'owner', 'task', result.outputArtifact.uri, 'stdout', 0, 500);
    assert.equal(out.bytes.toString(), '中文 "quoted" \\ textunset');
    const error = await rawOutput(tools, 'owner', 'task', result.outputArtifact.uri, 'stderr', 0, 500);
    assert.equal(error.bytes.toString(), 'error');
    await assert.rejects(rawOutput(tools, 'other', 'task', result.outputArtifact.uri, 'stdout', 0, 10), {
      code: 'TASK_NOT_FOUND',
    });
    await assert.rejects(
      tools.write('owner', { taskId: 'task', path: 'x', content: 'a', idempotencyKey: 'key' }),
      { code: 'IDEMPOTENCY_CONFLICT' }
    );
    await tools.stopTask('owner', 'task');
    assert.deepEqual(await tools.powershell('owner', input), result);
  });
});

test('PowerShell carries near-limit multiline literal commands without command-line expansion and removes completed scripts', async () => {
  await fixture(async ({ tools, root }) => {
    const source =
      "[Console]::Write('中文 ''quote'' `literal $dollar \\\\ path')\r\n[Console]::Write(\"`nsecond line\")\r\n#";
    const command = source + 'x'.repeat(16384 - Buffer.byteLength(source));
    assert.equal(Buffer.byteLength(command), 16384);
    const result = await tools.powershell('owner', { taskId: 'task', command, idempotencyKey: 'limit' });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.output, "中文 'quote' `literal $dollar \\\\ path\nsecond line");
    const directory = join(
      root,
      'shell',
      '.octopus-executor-recovery-' + result.outputArtifact.uri.slice('executor-output://'.length)
    );
    await assert.rejects(readFile(join(directory, '.octopus-executor-recovery-home/command.ps1')), {
      code: 'ENOENT',
    });
    await assert.rejects(
      tools.powershell('owner', { taskId: 'task', command: command + 'x', idempotencyKey: 'over-limit' }),
      { code: 'INVALID_INPUT' }
    );
  });
});

test('PowerShell reports actual process exits, terminating/non-terminating errors and explicit native exit propagation', async () => {
  await fixture(async ({ tools, shell }) => {
    assert.equal(shell.status().available, true);
    assert.equal(shell.status().kind, 'powershell');
    assert.match(shell.status().version, /^5\.1\./);
    for (const [key, command, exitCode] of [
      ['exit', 'exit 7', 7],
      ['throw', "throw 'fixture terminating error'", 1],
      ['non-terminating', "Write-Error 'fixture error'; [Console]::Write('continued')", 0],
      ['native-default', nodeCommand('process.exit(17)'), 0],
      ['native-propagated', nodeCommand('process.exit(17)') + '; exit $LASTEXITCODE', 17],
    ]) {
      const result = await tools.powershell('owner', { taskId: 'task', command, idempotencyKey: key });
      assert.equal(result.exitCode, exitCode, result.output);
      assert.equal(result.executionState, 'quiescent');
      if (key === 'non-terminating') {
        assert.match(result.output, /continued/);
        assert.ok(result.outputArtifact.stderrBytes > 0);
      }
    }
  });
});

test('missing system PowerShell is reported without adopting a PATH executable or blocking file tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-shell-missing-'));
  const native = new NativeFileCommit(join(resources, 'native/file-commit.node'));
  const node = await testNodeResources(resources, native);
  const systemRoot = process.env.SystemRoot;
  let shell;
  try {
    process.env.SystemRoot = join(root, 'missing-system');
    shell = await ShellExecutor.open(join(resources, 'native/process-supervisor.exe'), root, native, node);
    assert.deepEqual(shell.status(), {
      kind: 'powershell',
      version: null,
      available: false,
      code: 'SHELL_NOT_FOUND',
    });
  } finally {
    process.env.SystemRoot = systemRoot;
    await shell?.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-shell-missing-')));
    await rm(root, { recursive: true, force: true });
  }
});

test('timeout and stop confirm tree cleanup; a queued call never starts after stop', async () => {
  await fixture(async ({ tools, workspace }) => {
    const timed = await tools.powershell('owner', {
      taskId: 'task',
      command: 'Start-Sleep -Seconds 30',
      timeout: 1,
      idempotencyKey: 'timeout',
    });
    assert.equal(timed.terminationReason, 'timeout');
    assert.equal(timed.executionState, 'quiescent');
    const running = tools.powershell('owner', {
      taskId: 'task',
      command:
        "[IO.File]::WriteAllText([IO.Path]::Combine($PWD.Path, 'stop-started'), 'started'); Start-Sleep -Seconds 30",
      idempotencyKey: 'stop',
    });
    const queued = tools.powershell('owner', {
      taskId: 'task',
      command: "[IO.File]::WriteAllText([IO.Path]::Combine($PWD.Path, 'should-not-exist'), '')",
      idempotencyKey: 'queued',
    });
    const rejected = assert.rejects(queued, { code: 'TASK_STOPPED' });
    let started = false;
    for (let attempt = 0; attempt < 400; attempt++) {
      try {
        started = (await readFile(join(workspace, 'stop-started'), 'utf8')) === 'started';
      } catch {
        /* Await the fixture's actual process dispatch. */
      }
      if (started) {
        break;
      }
      await new Promise((accept) => setTimeout(accept, 25));
    }
    assert.ok(started, 'The stop fixture must reach actual dispatch after resource verification.');
    await tools.stopTask('owner', 'task');
    assert.equal((await running).terminationReason, 'cancelled');
    await rejected;
    assert.equal(tools.taskStatus('owner', 'task').state, 'stopped');
    const { stat } = await import('node:fs/promises');
    await assert.rejects(stat(join(workspace, 'should-not-exist')), { code: 'ENOENT' });
  });
});

test('background lifetime is rejected while explicit shell wait is accepted; shell execution invalidates file observations', async () => {
  await fixture(async ({ tools, workspace }) => {
    const background = await tools.powershell('owner', {
      taskId: 'task',
      command: `Start-Process -FilePath ${psLiteral(process.execPath)} -ArgumentList '-e','setTimeout(()=>{},30000)' -NoNewWindow`,
      idempotencyKey: 'background',
    });
    assert.equal(background.terminationReason, 'background_process_rejected');
    const waited = await tools.powershell('owner', {
      taskId: 'task',
      command: `Start-Process -FilePath ${psLiteral(process.execPath)} -ArgumentList '-e','setTimeout(()=>{},100)' -NoNewWindow -Wait`,
      idempotencyKey: 'waited',
    });
    assert.equal(waited.terminationReason, 'completed');
    await writeFile(join(workspace, 'a'), 'old');
    await tools.read('owner', { taskId: 'task', path: 'a' });
    await tools.powershell('owner', { taskId: 'task', command: '$null = 1', idempotencyKey: 'invalidate' });
    await assert.rejects(
      tools.write('owner', { taskId: 'task', path: 'a', content: 'new', idempotencyKey: 'write' }),
      { code: 'EXPECTED_VERSION_REQUIRED' }
    );
  });
});

test('large and invalid UTF-8 output is drained and retained without forging native completion', async () => {
  await fixture(async ({ tools }) => {
    const result = await tools.powershell('owner', {
      taskId: 'task',
      command: nodeCommand(
        "process.stdout.write(Buffer.alloc(100000,97));process.stdout.write(Buffer.from([255]));process.stdout.write('done')"
      ),
      idempotencyKey: 'output',
    });
    assert.equal(result.terminationReason, 'completed');
    assert.equal(result.truncated, true);
    assert.equal(result.replacementUsed, true);
    assert.ok(Buffer.byteLength(result.output) <= 51200);
    assert.equal(result.outputArtifact.stdoutBytes, 100005);
    const raw = await rawOutput(tools, 'owner', 'task', result.outputArtifact.uri, 'stdout', 100000, 5);
    assert.deepEqual(raw.bytes, Buffer.from([255, 100, 111, 110, 101]));
  });
});

test('64 MiB combined hard limit terminates the Job and seals only the bounded prefix', async () => {
  await fixture(async ({ tools }) => {
    const result = await tools.powershell('owner', {
      taskId: 'task',
      command: nodeCommand('process.stdout.write(Buffer.alloc(73400320))'),
      idempotencyKey: 'hard-limit',
    });
    assert.equal(result.terminationReason, 'output_limit');
    assert.equal(result.outputArtifact.stdoutBytes + result.outputArtifact.stderrBytes, 64 * 1024 * 1024);
    assert.equal(result.executionState, 'quiescent');
    assert.ok(Buffer.byteLength(result.output) <= 51200);
  });
});

test('closing the supervisor kills its exact owned native descendant through Job lifetime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-job-loss-'));
  let supervisor;
  let descendant;
  try {
    const command = nodeCommand(
      'require("node:fs").writeFileSync("child-pid",String(process.pid));setInterval(()=>{},1000)',
      process.execPath
    );
    const script = join(root, 'command.ps1');
    await writeFile(script, '\ufeff' + command);
    supervisor = spawn(
      join(resources, 'native', 'process-supervisor.exe'),
      [selectShellPlatform(), root, '--powershell', '30000', String(process.pid), script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    supervisor.stdout.resume();
    const { readFile } = await import('node:fs/promises');
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        descendant = Number(await readFile(join(root, 'child-pid'), 'utf8'));
        break;
      } catch {
        await new Promise((accept) => setTimeout(accept, 25));
      }
    }
    assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
    process.kill(descendant, 0);
    const exited = new Promise((accept) => supervisor.once('close', accept));
    supervisor.kill();
    await exited;
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt++) {
      try {
        process.kill(descendant, 0);
        await new Promise((accept) => setTimeout(accept, 25));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false);
    descendant = undefined;
  } finally {
    supervisor?.kill();
    if (descendant) {
      try {
        process.kill(descendant);
      } catch {
        // The exact test-owned descendant may already have exited with its Job.
      }
    }
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-job-loss-')));
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

test('same-user changes to a sealed output file fail version validation, and read-only tasks cannot read shell artifacts', async () => {
  await fixture(async ({ tools, workspace, root }) => {
    const result = await tools.powershell('owner', {
      taskId: 'task',
      command: "[Console]::Write('sealed')",
      idempotencyKey: 'sealed',
    });
    await tools.registerTask({
      taskId: 'reader',
      ownerId: 'owner',
      cwd: workspace,
      permissions: ['files.read'],
    });
    await assert.rejects(rawOutput(tools, 'owner', 'reader', result.outputArtifact.uri, 'stdout', 0, 20), {
      code: 'PERMISSION_DENIED',
    });
    const id = result.outputArtifact.uri.slice('executor-output://'.length);
    await writeFile(join(root, 'shell', `.octopus-executor-recovery-${id}`, 'stdout'), 'altered');
    await assert.rejects(rawOutput(tools, 'owner', 'task', result.outputArtifact.uri, 'stdout', 0, 20), {
      code: 'OUTPUT_CHANGED',
    });
  });
});

test('abrupt parent exit is observed by the supervisor and cleans the exact owned descendant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-parent-loss-'));
  let parent;
  let descendant;
  try {
    const command = nodeCommand(
      'require("node:fs").writeFileSync("child-pid",String(process.pid));setInterval(()=>{},1000)',
      process.execPath
    );
    const script = join(root, 'command.ps1');
    await writeFile(script, '\ufeff' + command);
    parent = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../fixtures/supervisor-parent.mjs', import.meta.url)),
        join(resources, 'native', 'process-supervisor.exe'),
        selectShellPlatform(),
        root,
        script,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    parent.stdout.resume();
    const { readFile } = await import('node:fs/promises');
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        descendant = Number(await readFile(join(root, 'child-pid'), 'utf8'));
        break;
      } catch {
        await new Promise((accept) => setTimeout(accept, 25));
      }
    }
    assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
    process.kill(descendant, 0);
    const exited = new Promise((accept) => parent.once('close', accept));
    parent.kill();
    await exited;
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt++) {
      try {
        process.kill(descendant, 0);
        await new Promise((accept) => setTimeout(accept, 25));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false);
    descendant = undefined;
  } finally {
    parent?.kill();
    if (descendant) {
      try {
        process.kill(descendant);
      } catch {
        /* Already terminated by the owned Job. */
      }
    }
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-parent-loss-')));
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});
