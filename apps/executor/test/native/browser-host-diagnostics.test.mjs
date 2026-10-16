/**
 * @author Codex
 * @description Exercises the read-only packaged Host diagnostic with isolated registry keys, UTF-8 paths and the complete browser identity.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');

test('Host diagnostics accept complete origins and UTF-8 paths without changing registrations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-host-diagnostics-'));
  const registry = `HKCU:\\Software\\OctopusHostTest-${randomUUID()}`;
  const source = await readFile(join(appRoot, 'test/packaging/diagnose-browser-host.ps1'), 'utf8');
  const script = join(root, 'diagnose.ps1');
  const original =
    "$taskKey = 'HKCU:\\Software\\' + $taskVendor + '\\NativeMessagingHosts\\com.octopus.executor.browser'";
  const isolated = source.replace(original, `$taskKey = '${registry}\\' + $taskBrowser`);
  assert.notEqual(isolated, source);
  await writeFile(script, isolated);
  const product = join(root, '用户 bundle');
  const resource = join(product, 'resources/executor');
  const manifestPath = join(resource, 'bridge/native-host.json');
  const { identity } = JSON.parse(await readFile(join(appRoot, 'dist/browser-identity.json'), 'utf8'));
  assert.equal(identity.allowedOrigins.length, 3);
  const manifest = {
    name: 'com.octopus.executor.browser',
    type: 'stdio',
    path: join(resource, 'native/browser-launcher.exe'),
    allowed_origins: identity.allowedOrigins,
  };
  /**
   * Invokes the real diagnostic with only its registry destination redirected into fixture-owned keys.
   */
  const diagnose = async (name) => {
    const report = join(root, name + '.json');
    await run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-ProductDirectory',
        product,
        '-ReportPath',
        report,
      ],
      { windowsHide: true }
    );
    return JSON.parse(await readFile(report, 'utf8'));
  };
  try {
    for (const file of [
      'native/browser-launcher.exe',
      'native/file-commit.node',
      'bridge/native-host.cjs',
      'resources/node/node.exe',
    ]) {
      const target = join(resource, file);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, 'presence-only fixture');
    }
    await writeFile(join(resource, 'browser-identity.json'), JSON.stringify({ identity }));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `New-Item -Path '${registry}\\Chrome' -Force | Out-Null; Set-Item -LiteralPath '${registry}\\Chrome' -Value '${manifestPath}'`,
      ],
      { windowsHide: true }
    );
    assert.deepEqual((await diagnose('valid')).browsers, [
      { browser: 'Chrome', state: 'registered-resources-present' },
      { browser: 'Edge', state: 'missing' },
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, allowed_origins: identity.allowedOrigins.slice(0, 2) })
    );
    assert.equal((await diagnose('incomplete')).browsers[0].state, 'invalid-selected-installation');
    const registered = await run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); (Get-Item -LiteralPath '${registry}\\Chrome').GetValue('')`,
      ],
      { windowsHide: true }
    );
    assert.equal(registered.stdout.trim(), manifestPath);
  } finally {
    await run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `if (Test-Path -LiteralPath '${registry}') { Remove-Item -LiteralPath '${registry}' -Recurse }`,
      ],
      { windowsHide: true }
    );
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
    await rm(root, { recursive: true, force: true });
  }
});
