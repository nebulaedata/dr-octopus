/**
 * @author Codex
 * @description Runs production Basic modules inside a real Electron Utility Process using only a test-owned workspace.
 */
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { prepareEdit } from '../../src/runtime/basic/edit-plan.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { dirname, join } from 'node:path';
import { NodeResources } from '../../src/runtime/basic/node-resources.ts';
import { ShellExecutor } from '../../src/runtime/basic/shell-executor.ts';
import { SearchTools } from '../../src/runtime/basic/search-tools.ts';

const port = process.parentPort;
if (!port) {
  throw new Error('This fixture requires an Electron Utility Process.');
}
const keepAlive = setInterval(() => {}, 60_000);
port.on('message', ({ data }) => {
  if (data === 'shutdown') {
    clearInterval(keepAlive);
    process.exit(0);
  }
});

/**
 * Exercises copied grants, paging, owner denial and exact edit preparation in the actual loading process.
 */
async function evaluateBasicTools() {
  const root = process.argv[2];
  const native = new NativeFileCommit(process.argv[3]);
  const publisher = await FilePublication.open(native, dirname(root));
  const shell = await ShellExecutor.open(
    join(dirname(process.argv[3]), 'process-supervisor.exe'),
    dirname(root),
    native,
    await NodeResources.open(join(dirname(process.argv[3]), '..'), native, process.argv[4])
  );
  const search = new SearchTools(
    join(dirname(process.argv[3]), 'process-supervisor.exe'),
    join(dirname(process.argv[3]), '..', 'resources', 'search'),
    dirname(root),
    native
  );
  await search.verify();
  const reader = new BasicTools(publisher, shell, search);
  await reader.registerTask({
    taskId: 'fixture',
    ownerId: 'fixture-client',
    cwd: root,
    permissions: ['files.write', 'shell.execute'],
  });
  try {
    const first = await reader.read('fixture-client', { taskId: 'fixture', path: 'input.txt', limit: 1 });
    const second = await reader.read('fixture-client', {
      taskId: 'fixture',
      path: 'input.txt',
      ...first.next,
    });
    let deniedCode;
    try {
      await reader.read('other-client', { taskId: 'fixture', path: 'input.txt' });
    } catch (error) {
      deniedCode = error.code;
    }
    const plan = prepareEdit(Buffer.from(first.text + second.text), [
      { oldText: 'first', newText: 'updated' },
    ]);
    const published = await reader.write('fixture-client', {
      taskId: 'fixture',
      path: 'output.txt',
      expectedVersion: 'absent',
      content: plan.content.toString('utf8'),
      idempotencyKey: 'fixture-publication',
    });
    const edited = await reader.edit('fixture-client', {
      taskId: 'fixture',
      path: 'output.txt',
      edits: [{ oldText: 'updated', newText: 'final' }],
      idempotencyKey: 'fixture-edit',
    });
    const readBack = await reader.read('fixture-client', { taskId: 'fixture', path: 'output.txt' });
    const powershell = await reader.powershell('fixture-client', {
      taskId: 'fixture',
      command: "[Console]::Write('私有 PowerShell')",
      idempotencyKey: 'fixture-powershell',
    });
    const shellOutput = await reader.read('fixture-client', {
      taskId: 'fixture',
      path: powershell.outputArtifact.uri + '/stdout',
    });
    const found = await reader.find('fixture-client', { taskId: 'fixture', pattern: '**/*.txt' });
    const matched = await reader.grep('fixture-client', {
      taskId: 'fixture',
      pattern: '第二😀',
      literal: true,
    });
    const listed = await reader.ls('fixture-client', { taskId: 'fixture' });
    return {
      first,
      second,
      deniedCode,
      edit: plan.content.toString(),
      node: process.versions.node,
      electron: process.versions.electron,
      published,
      edited,
      readBack,
      powershell,
      shellOutput,
      found,
      matched,
      listed,
    };
  } finally {
    await reader.stopTask('fixture-client', 'fixture');
    await reader.close();
  }
}

evaluateBasicTools().then(
  (result) => port.postMessage({ ok: true, result }),
  (error) => port.postMessage({ ok: false, code: error.code, message: error.message })
);
