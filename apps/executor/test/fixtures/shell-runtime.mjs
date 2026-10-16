/**
 * @author Codex
 * @description Runs the production shell task service in a test-owned Node parent for crash recovery verification.
 */
import { join } from 'node:path';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { testNodeResources } from './node-resources.mjs';
import { ShellExecutor } from '../../src/runtime/basic/shell-executor.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';

const [root, resources] = process.argv.slice(2);
const native = new NativeFileCommit(join(resources, 'native', 'file-commit.node'));
const publication = await FilePublication.open(native, root);
const shell = await ShellExecutor.open(
  join(resources, 'native', 'process-supervisor.exe'),
  root,
  native,
  await testNodeResources(resources, native)
);
const tools = new BasicTools(publication, shell);
await tools.registerTask({
  ownerId: 'owner',
  taskId: 'crash',
  cwd: root,
  permissions: ['shell.execute'],
});
process.stdout.write('ready\n');
await tools.powershell('owner', {
  taskId: 'crash',
  command: "[IO.File]::AppendAllText([IO.Path]::Combine($PWD.Path, 'counter'), 'x'); Start-Sleep -Seconds 30",
  idempotencyKey: 'crash-key',
});
await tools.close();
