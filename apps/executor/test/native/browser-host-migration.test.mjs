/**
 * @author Codex
 * @description Exercises product Host migration and old-version removal with isolated registry keys and temporary bundles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, link, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const { identity } = JSON.parse(await readFile(join(appRoot, 'dist/browser-identity.json'), 'utf8'));

test('Host migration handles UTF-8 paths, rejects foreign manifests and preserves the new registration on old uninstall', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-host-migration-'));
  const registry = `HKCU:\\Software\\OctopusHostTest-${randomUUID()}`;
  const source = await readFile(join(appRoot, 'dist/setup/register-browser-host.ps1'), 'utf8');
  const script = join(root, 'register.ps1');
  await writeFile(
    script,
    source.replace(
      "$keys = @('HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.octopus.executor.browser', 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.octopus.executor.browser')",
      `$keys = @('${registry}\\Chrome', '${registry}\\Edge')`
    )
  );
  assert.notEqual(await readFile(script, 'utf8'), source);
  const data = join(root, '用户 data');
  await mkdir(data);
  /**
   * Runs only the copied production installer against the isolated test keys.
   */
  const install = (bundle, mode = 'install', migrate = true) =>
    run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Mode',
        mode,
        '-ResourceRoot',
        bundle,
        '-ProjectRoot',
        data,
        ...(migrate ? ['-MigrateProduct'] : []),
      ],
      { windowsHide: true }
    );
  /**
   * Reads a test registration without accessing the real browser Host keys.
   */
  const registered = async () =>
    (
      await run(
        powershell,
        [
          '-NoProfile',
          '-Command',
          `[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); (Get-Item -LiteralPath '${registry}\\Chrome').GetValue('')`,
        ],
        { windowsHide: true }
      )
    ).stdout.trim();
  try {
    for (const name of ['旧 bundle', '新 bundle']) {
      const bundle = join(root, name);
      for (const dir of ['native', 'bridge', 'resources/node']) {
        await mkdir(join(bundle, dir), { recursive: true });
      }
      for (const file of [
        'native/browser-launcher.exe',
        'native/file-commit.node',
        'bridge/native-host.cjs',
        'resources/node/LICENSE',
      ]) {
        await copyFile(join(appRoot, 'dist', file), join(bundle, file));
      }
      await link(
        join(appRoot, 'dist/resources/node/node.exe'),
        join(bundle, 'resources/node/node.exe')
      ).catch(() =>
        copyFile(join(appRoot, 'dist/resources/node/node.exe'), join(bundle, 'resources/node/node.exe'))
      );
    }
    const old = join(root, '旧 bundle');
    const current = join(root, '新 bundle');
    await install(old);
    const oldManifestPath = join(old, 'bridge/native-host.json');
    const oldManifest = JSON.parse(await readFile(oldManifestPath, 'utf8'));
    assert.deepEqual(oldManifest.allowed_origins, identity.allowedOrigins);
    await assert.rejects(install(current, 'install', false), /foreign Native Host/);
    await install(current);
    await install(current);
    await install(current, 'install', false);
    assert.equal((await registered()).toLowerCase(), join(current, 'bridge/native-host.json').toLowerCase());
    await install(old, 'remove');
    assert.equal((await registered()).toLowerCase(), join(current, 'bridge/native-host.json').toLowerCase());
    const manifestPath = join(current, 'bridge/native-host.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(manifest.allowed_origins, identity.allowedOrigins);
    for (const invalidOrigins of [
      ...(identity.allowedOrigins.length > 1 ? [[identity.allowedOrigins[0]]] : []),
      null,
      [null],
      ['chrome-extension://foreign/'],
      [identity.allowedOrigins[0], identity.allowedOrigins[0]],
      [...identity.allowedOrigins, 'chrome-extension://foreign/'],
    ]) {
      manifest.allowed_origins = invalidOrigins;
      await writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(install(old), /Unrecognized Native Host/);
      assert.equal((await registered()).toLowerCase(), manifestPath.toLowerCase());
    }
    await rm(manifestPath);
    await assert.rejects(install(old), /Registered Native Host manifest is missing/);
    assert.equal((await registered()).toLowerCase(), manifestPath.toLowerCase());
    await install(current, 'remove');
  } finally {
    await run(
      powershell,
      [
        '-NoProfile',
        '-Command',
        `if (Test-Path -LiteralPath '${registry}') { Remove-Item -LiteralPath '${registry}' -Recurse }`,
      ],
      { windowsHide: true }
    );
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
    await rm(root, { recursive: true, force: true });
  }
});
