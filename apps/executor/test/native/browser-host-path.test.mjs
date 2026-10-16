/**
 * @author Codex
 * @description Verifies the registration script resolves the same private directory across virtualized and physical filesystem paths without touching Host registrations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

const run = promisify(execFile);
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');

test('Host data resolution preserves private directory identity and rejects files or missing paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-host-path-'));
  const native = new NativeFileCommit(join(appRoot, 'dist/native/file-commit.node'));
  const data = join(root, '.octopus-executor-recovery-设备 browser');
  const script = join(root, 'resolve-path.ps1');
  try {
    assert.equal((await native.createRecovery(data)).ok, true);
    await writeFile(
      script,
      `param([string]$Source,[string]$Data)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$tokens=$null
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Registration script syntax error.' }
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-BrowserHostDirectory'},$true))
if ($functions.Count -ne 1) { throw 'Expected one production directory resolver.' }
. ([ScriptBlock]::Create($functions[0].Extent.Text))
Resolve-BrowserHostDirectory $Data
`,
      'utf8'
    );
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      script,
      '-Source',
      join(appRoot, 'src/installation/windows/register-browser-host.ps1'),
      '-Data',
    ];
    const { stdout } = await run(powershell, [...args, data], { windowsHide: true });
    const resolved = stdout.trim();
    assert.match(resolved, /^[A-Za-z]:\\/);
    const before = await native.inspect(data);
    const after = await native.inspect(resolved);
    assert.equal(after.ok, true);
    assert.equal(after.privateAcl, true);
    assert.equal(after.identity, before.identity);
    await assert.rejects(run(powershell, [...args, script], { windowsHide: true }), /existing directories/);
    await assert.rejects(run(powershell, [...args, join(root, 'missing')], { windowsHide: true }));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
