/**
 * @author Codex
 * @description Compiles the production NSIS install hook and verifies its failure log using a disposable registration stub without touching real user data or registry keys.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const appRoot = fileURLToPath(new URL('../../', import.meta.url));

test('NSIS registration failure preserves exit details and writes a readable Unicode diagnostic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-installer-hook-'));
  try {
    const tools = JSON.parse(await readFile(join(appRoot, 'build/packaging-tools.json'), 'utf8'));
    const nsis = tools.records.find((record) => record.name === 'nsis');
    const compiler = join(nsis.directory, 'windows/Bin/makensis.exe');
    const source = await readFile(join(appRoot, 'src/installation/windows/installer.nsh'), 'utf8');
    const project = join(root, 'private-project');
    const installation = join(root, '用户 installation');
    const logs = join(root, 'logs');
    const setup = join(installation, 'resources/executor/setup');
    await mkdir(setup, { recursive: true });
    await mkdir(logs);
    await writeFile(
      join(setup, 'register-browser-host.ps1'),
      "param($Mode, $ResourceRoot, $ProjectRoot, [switch]$MigrateProduct)\r\nWrite-Output 'fixture registration refusal'\r\nexit 23\r\n"
    );
    // Redirect only the hook's project path. All install-hook control flow and diagnostic instructions stay intact.
    const copied = source.replaceAll('$PROFILE\\.dr-octopus\\executor', project);
    assert.notEqual(copied, source);
    const hook = join(root, 'installer.nsh');
    await writeFile(hook, copied);
    const harness = join(root, 'harness.nsi');
    const executable = join(root, 'harness.exe');
    await writeFile(
      harness,
      [
        'Unicode true',
        'RequestExecutionLevel user',
        'SilentInstall silent',
        `OutFile "${executable}"`,
        '!include "LogicLib.nsh"',
        `!include "${hook}"`,
        'Section',
        `  StrCpy $INSTDIR "${installation}"`,
        '  !insertmacro customInstall',
        'SectionEnd',
        '',
      ].join('\r\n')
    );
    await run(compiler, ['/INPUTCHARSET', 'UTF8', '/V2', harness], { windowsHide: true });
    await assert.rejects(
      run(executable, ['/S'], { windowsHide: true, env: { ...process.env, TEMP: logs, TMP: logs } }),
      (error) => error.code === 1
    );
    const entries = await readdir(logs);
    assert.equal(entries.length, 1);
    assert.ok(entries[0].endsWith('.txt'));
    const bytes = await readFile(join(logs, entries[0]));
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
    const diagnostic = bytes.subarray(2).toString('utf16le');
    assert.ok(diagnostic.includes('Exit code: 23'), diagnostic);
    assert.ok(diagnostic.includes('fixture registration refusal'));
    assert.ok(diagnostic.includes(join(installation, 'resources/executor')));
    assert.ok(diagnostic.includes(project));
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
    await rm(root, { recursive: true, force: true });
  }
});
