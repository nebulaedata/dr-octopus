/**
 * @author Codex
 * @description Verifies hardened release files, production packaged resource loading, and a real per-user installer without claiming clean-machine acceptance.
 */
import { createClientConfiguration } from '../integration/client-configuration.mjs';
import { bridgeVersion } from '@octopus/shared/protocol/browser-bridge';
import { deviceConnectionKey } from '../../src/contracts/device-identity.ts';
import { executorProduct } from '../../src/contracts/product.ts';
import { parseBrowserIdentity } from '../../../browser-extension/scripts/lib/browser-identity.mjs';
import {
  verifyBuiltBrowserIdentity,
  verifyBundledBrowserExtensions,
} from '../../scripts/lib/compile/browser-identity.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve, basename, sep } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { readFrames, writeFrame } from '../../src/bridge/native-framing.ts';
import { FuseV1Options, FuseState, FuseVersion, getCurrentFuseWire, flipFuses } from '@electron/fuses';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { networkAddressSchema } from '../../src/contracts/connection-settings.ts';
import { verifyRuntimeManifest } from '../../scripts/lib/package/runtime-manifest.mjs';

const output = resolve(process.env.EXECUTOR_ACCEPTANCE_DIR || 'missing-acceptance-output');
// A fresh ZIP extraction uses the same artifact identity and full inventory assertions as win-unpacked.
const product = resolve(process.env.EXECUTOR_ACCEPTANCE_PRODUCT_DIR || join(output, 'win-unpacked'));
const executable = join(product, 'Dr.Octopus Executor.exe');
const artifact = JSON.parse(await readFile(join(output, 'acceptance-artifacts.json'), 'utf8'));
const system32 = join(process.env.SystemRoot, 'System32');

test('private companion backs up and restores stopped data without ambient Node or overwriting originals', async () => {
  const kitName =
    process.env.EXECUTOR_ACCEPTANCE_KIT ||
    (await readdir(output)).find((name) => name.startsWith('acceptance-kit-'));
  const kit = join(output, kitName);
  const prefix = join(tmpdir(), 'octopus-packaged-data-backup-');
  const temporary = await mkdtemp(prefix);
  const data = join(temporary, 'data');
  const backup = join(temporary, '.octopus-executor-recovery-backup');
  const restored = join(temporary, '.octopus-executor-recovery-restored');
  await mkdir(data);
  await writeFile(join(data, 'sentinel'), 'retained data');
  const env = {
    ...process.env,
    PATH: system32,
    NODE_OPTIONS: '--require=unavailable-loader.cjs',
    NODE_PATH: 'unavailable-modules',
  };
  const powershell = join(system32, 'WindowsPowerShell/v1.0/powershell.exe');
  /**
   * Calls only the matching companion using explicit test paths and the actual product's private Node.
   */
  const args = (mode, source, target) => [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(kit, 'data-backup.ps1'),
    '-Mode',
    mode,
    '-ProductDirectory',
    product,
    '-DataDirectory',
    data,
    '-SourceDirectory',
    source,
    '-OutputDirectory',
    target,
  ];
  try {
    const blocker = spawn(
      join(product, 'resources/executor/resources/node/node.exe'),
      ['--eval', 'setTimeout(()=>{},30000)', data],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } }
    );
    const blockerExited = once(blocker, 'exit');
    try {
      await assert.rejects(
        command(powershell, args('backup', data, backup), 30000, env),
        (error) => error.message.includes('Selected Executor') && error.message.includes('still in use')
      );
      await assert.rejects(readFile(join(backup, 'executor-data-backup.json')), { code: 'ENOENT' });
    } finally {
      blocker.kill();
      await blockerExited;
    }
    await command(powershell, args('backup', data, backup), 30000, env);
    await command(powershell, args('restore', backup, restored), 30000, env);
    assert.equal(await readFile(join(restored, 'sentinel'), 'utf8'), 'retained data');
    await assert.rejects(command(powershell, args('restore', backup, restored), 30000, env));
    assert.equal(await readFile(join(data, 'sentinel'), 'utf8'), 'retained data');
    const script = join(kit, 'data-backup.cjs');
    const scriptBytes = await readFile(script);
    // Corruption remains isolated to a copied kit, preserving the release's original companion.
    const copiedKit = join(temporary, 'copied-kit');
    await cp(kit, copiedKit, { recursive: true });
    await writeFile(
      join(copiedKit, 'data-backup.cjs'),
      Buffer.concat([scriptBytes, Buffer.from('\n//changed')])
    );
    const changedArgs = args('backup', data, join(temporary, '.octopus-executor-recovery-rejected'));
    changedArgs[5] = join(copiedKit, 'data-backup.ps1');
    await assert.rejects(command(powershell, changedArgs, 30000, env));
  } finally {
    assert.ok(temporary.startsWith(prefix));
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('packaged Chrome/Edge include the current popup, icon family and complete extension build bytes', async () => {
  const extensionRoot = resolve(import.meta.dirname, '../../../browser-extension');
  const expectedVersion = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf8')).version;
  const resource = join(product, 'resources/executor');
  const { identity } = JSON.parse(await readFile(join(resource, 'browser-identity.json'), 'utf8'));
  const client = await verifyBuiltBrowserIdentity(parseBrowserIdentity(identity), resource);
  await verifyBundledBrowserExtensions(client, join(extensionRoot, '.output'));
  for (const flavor of ['chrome', 'edge']) {
    const built = join(extensionRoot, '.output', flavor + '-mv3');
    const bundled = join(product, 'resources/browser', flavor);
    const manifest = JSON.parse(await readFile(join(bundled, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, expectedVersion);
    assert.equal(manifest.action.default_popup, 'popup.html');
    assert.deepEqual(manifest.action.default_icon, manifest.icons);
    for (const size of [16, 32, 48, 128]) {
      const bytes = await readFile(join(bundled, manifest.icons[size]));
      assert.equal(bytes.readUInt32BE(16), size);
      assert.equal(bytes.readUInt32BE(20), size);
    }
    const paths = (await readdir(built, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(built.length + 1));
    for (const path of paths) {
      assert.deepEqual(
        await readFile(join(bundled, path)),
        await readFile(join(built, path)),
        'Packaged extension differs: ' + flavor + '/' + path
      );
    }
    assert.equal(
      (await readdir(bundled, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())
        .length,
      paths.length
    );
  }
  const guide = await readFile(join(product, 'resources/browser/INSTALLATION.md'), 'utf8');
  assert.equal(guide, await readFile(join(extensionRoot, 'INSTALLATION.md'), 'utf8'));
  assert.ok(
    guide.includes(expectedVersion),
    'The bundled extension guide must describe the current version.'
  );
});

test('final packaged inventory matches complete product bytes and artifact build identity', async () => {
  const manifest = JSON.parse(await readFile(join(product, 'runtime-manifest.json'), 'utf8'));
  const verified = await verifyRuntimeManifest(product, manifest);
  assert.equal(verified.productBuildId, artifact.productBuildId);
  assert.ok(verified.files > 5988);
  assert.equal(manifest.availability.computerEnabled, true);
  assert.equal(manifest.availability.shellNode, true);
  assert.equal(manifest.availability.npmBundled, true);
  assert.deepEqual(manifest.components.systemShell, {
    kind: 'powershell',
    versionFamily: '5.1',
    source: 'operating-system',
  });
  assert.ok(manifest.tools.basic.includes('powershell'));
  assert.ok(!manifest.tools.basic.includes('bash'));
  assert.ok(!manifest.files.some((file) => /portable-git|bash-supervisor/i.test(file.path)));
  assert.equal(manifest.components.npm, '11.19.0');
});

test('portable inventory verifier uses private Node and preserves evidence and unsigned acceptance boundaries', async () => {
  const kitName =
    process.env.EXECUTOR_ACCEPTANCE_KIT ||
    (await readdir(output)).find((name) => name.startsWith('acceptance-kit-'));
  assert.ok(kitName);
  assert.match(kitName, /^acceptance-kit-[a-f0-9-]{36}$/);
  const kit = join(output, kitName);
  const prefix = resolve(tmpdir(), 'octopus-inventory-evidence-');
  const temporary = await mkdtemp(prefix);
  const env = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.SystemRoot,
    PATH: system32,
    TEMP: temporary,
    TMP: temporary,
    NODE_OPTIONS: '--require=unavailable-loader.cjs',
    NODE_PATH: 'unavailable-modules',
  };
  const powershell = join(system32, 'WindowsPowerShell/v1.0/powershell.exe');
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(kit, 'verify-runtime-manifest.ps1'),
    '-ProductDirectory',
    product,
    '-ReportPath',
    join(temporary, 'verified.json'),
  ];
  try {
    await command(powershell, args, 120000, env);
    const bytes = await readFile(join(temporary, 'verified.json'));
    const evidence = JSON.parse(bytes);
    assert.equal(evidence.passed, true);
    assert.equal(evidence.verification.productBuildId, artifact.productBuildId);
    assert.deepEqual(evidence.acceptance, { G4: 'pending', G5: 'pending', G6: 'pending' });
    assert.equal(evidence.publisherAuthentication, 'not-verified-unsigned-acceptance');
    await assert.rejects(command(powershell, args, 120000, env));
    assert.deepEqual(await readFile(join(temporary, 'verified.json')), bytes);
    const incomplete = join(temporary, 'incomplete-product');
    const nodeRelative = 'resources/executor/resources/node/node.exe';
    await mkdir(join(incomplete, 'resources/executor/resources/node'), { recursive: true });
    await cp(join(product, nodeRelative), join(incomplete, nodeRelative));
    await cp(join(product, 'runtime-manifest.json'), join(incomplete, 'runtime-manifest.json'));
    const failureArgs = [...args];
    failureArgs[7] = incomplete;
    failureArgs[9] = join(temporary, 'incomplete.json');
    await assert.rejects(command(powershell, failureArgs, 120000, env));
    const rejected = JSON.parse(await readFile(join(temporary, 'incomplete.json')));
    assert.equal(rejected.passed, false);
    assert.equal(rejected.error, 'RELEASE_INVENTORY_VERIFICATION_FAILED');
    failureArgs[9] = join(incomplete, 'must-not-write.json');
    await assert.rejects(command(powershell, failureArgs, 120000, env));
    await assert.rejects(readFile(join(incomplete, 'must-not-write.json')), { code: 'ENOENT' });
    const corruptKit = join(temporary, 'corrupt-kit');
    await cp(kit, corruptKit, { recursive: true });
    await writeFile(join(corruptKit, 'verify-runtime-manifest.cjs'), 'corrupt');
    const corruptArgs = [...args];
    corruptArgs[5] = join(corruptKit, 'verify-runtime-manifest.ps1');
    corruptArgs[9] = join(temporary, 'corrupt.json');
    await assert.rejects(command(powershell, corruptArgs, 120000, env), /digest mismatch/);
    await assert.rejects(readFile(join(temporary, 'corrupt.json')), { code: 'ENOENT' });
  } finally {
    assert.ok(resolve(temporary).startsWith(prefix));
    await rm(temporary, { recursive: true, force: true });
  }
});

/**
 * Uses private settings, an isolated free port and explicit taskbar-close behavior independent of product defaults.
 */
async function isolatedPort(data, networkAddress = null) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const settings = await ConnectionSettings.open(
    new NativeFileCommit(join(product, 'resources/executor/native/file-commit.node')),
    join(data, 'project')
  );
  await settings.save({ port, networkAddress, closeBehavior: 'taskbar' });
  return port;
}

/**
 * Waits for an owned command with a finite deadline and never terminates processes by executable name.
 */
async function command(file, args, timeout = 120000, env) {
  const child = spawn(file, args, { windowsHide: true, stdio: 'pipe', env });
  let diagnostics = '';
  child.stdout.on('data', (bytes) => {
    diagnostics += bytes.toString();
  });
  child.stderr.on('data', (bytes) => {
    diagnostics += bytes.toString();
  });
  const timer = setTimeout(() => child.kill(), timeout);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, diagnostics);
    return diagnostics.trim();
  } finally {
    clearTimeout(timer);
  }
}

test('release disables Node injection and inspector and requires an integrity-checked ASAR', async () => {
  const wire = await getCurrentFuseWire(executable);
  for (const fuse of [
    FuseV1Options.RunAsNode,
    FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    FuseV1Options.EnableNodeCliInspectArguments,
  ]) {
    assert.equal(wire[fuse], FuseState.DISABLE);
  }
  for (const fuse of [
    FuseV1Options.OnlyLoadAppFromAsar,
    FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  ]) {
    assert.equal(wire[fuse], FuseState.ENABLE);
  }
  assert.equal(artifact.signed, false);
  assert.equal(artifact.productName, 'Dr.Octopus Executor');
  assert.equal(artifact.version, executorProduct.version);
  const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
  const asar = builderRequire('@electron/asar');
  const entries = asar
    .listPackage(join(product, 'resources/app.asar'))
    .map((entry) => entry.replaceAll('\\', '/'));
  assert.ok(entries.includes('/dist/main/index.js'));
  for (const entry of entries.filter(
    (entry) => entry.startsWith('/dist/renderer/') && /\.(html|js|css|svg|woff2)$/.test(entry)
  )) {
    assert.deepEqual(
      asar.extractFile(join(product, 'resources/app.asar'), entry.slice(1).replaceAll('/', sep)),
      await readFile(join(import.meta.dirname, '../../', entry.slice(1)))
    );
  }
  assert.deepEqual(
    await readFile(join(product, 'INSTALLATION.md')),
    await readFile(join(import.meta.dirname, '../../INSTALLATION.md'))
  );
  assert.ok(entries.every((entry) => !/node_modules|test\/|src\/|\.map$/.test(entry)));
  const icon = await readFile(join(product, 'resources/executor/assets/brand/app.ico'));
  assert.deepEqual(icon, await readFile(join(import.meta.dirname, '../../assets/brand/app.ico')));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 6);
  const frames = new Map();
  for (let index = 0; index < 6; index++) {
    const offset = 6 + index * 16;
    const size = icon[offset] || 256;
    assert.equal(icon[offset + 1] || 256, size);
    const start = icon.readUInt32LE(offset + 12);
    const length = icon.readUInt32LE(offset + 8);
    assert.ok(start + length <= icon.length);
    frames.set(size, icon.subarray(start, start + length));
  }
  assert.deepEqual([...frames.keys()], [16, 32, 48, 64, 128, 256]);
  const { NtExecutable, NtExecutableResource, Resource } = builderRequire('resedit');
  const installer = join(output, basename(artifact.files.find((file) => file.path.endsWith('.exe')).path));
  for (const path of [executable, installer]) {
    const resources = NtExecutableResource.from(
      NtExecutable.from(await readFile(path), { ignoreCert: true })
    );
    const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
    assert.ok(
      groups.some(
        (group) =>
          group.icons.length === 6 &&
          group.icons.every((item) => {
            const entry = resources.entries.find(
              (entry) => entry.type === 3 && entry.id === item.iconID && entry.lang === group.lang
            );
            const expected = frames.get(item.width || 256);
            return entry && expected && Buffer.from(entry.bin).equals(expected);
          })
      ),
      `Missing complete brand icon family in ${basename(path)}`
    );
  }
});

test(
  'packaged Computer owner uses fixed resources with private Node and closes without enabling control',
  { timeout: 60000 },
  async () => {
    const resource = join(product, 'resources/executor');
    const script = `
    const { createComputerBackend } = require(process.argv[1]);
    const { ComputerRuntime } = require(process.argv[2]);
    const backend = createComputerBackend(process.argv[3]);
    const startedAt = performance.now();
    const childProcess = require('node:child_process');
    const spawnBackend = childProcess.spawn;
    childProcess.spawn = (...args) => {
      const child = spawnBackend(...args);
      const record = value => process.stderr.write(JSON.stringify({stage:'packaged-computer-transport',elapsedMs:performance.now()-startedAt,...value})+'\\n');
      child.once('spawn', () => record({event:'spawn'}));
      child.once('close', code => record({event:'close',code}));
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (data,...rest) => {
        try { const value=JSON.parse(String(data)); record({event:'send',method:value.method,id:value.id}); } catch {}
        return write(data,...rest);
      };
      let buffer='';
      child.stdout.on('data', bytes => {
        buffer+=bytes;
        if(buffer.length>256*1024){record({event:'large-frame',bytes:buffer.length});buffer='';return;}
        let newline;
        while((newline=buffer.indexOf('\\n'))>=0){
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
          try { const value=JSON.parse(line); record({event:'receive',id:value.id,errorCode:value.error?.code}); } catch {record({event:'malformed-frame',bytes:line.length});}
        }
      });
      return child;
    };
    const connect = backend.connect.bind(backend);
    backend.connect = async () => {
      try { return await connect(); }
      catch(error) {
        const code = /^WINDOWS_MCP_[A-Z_]+$|^COMPUTER_[A-Z_]+$/.test(error?.message) ? error.message : 'UNCLASSIFIED_BACKEND_FAILURE';
        process.stderr.write(JSON.stringify({stage:'packaged-computer-connect',code,elapsedMs:performance.now()-startedAt})+'\\n');
        throw error;
      }
    };
    const owner = new ComputerRuntime({snapshot(){return {state:'idle'};},begin(){throw new Error('No input admitted');},endTasks(){}},backend);
    (async () => {
      try {
        await owner.start();
        process.stderr.write(JSON.stringify({stage:'packaged-computer-started',status:owner.status(),elapsedMs:performance.now()-startedAt})+'\\n');
        const contract = owner.status().available;
        const control=await (await backend.connect()).callTool('ControlStatus', {}, { timeoutMs: 10000 });
        if(!control.structuredContent?.state)throw new Error('No desktop metadata');
        await owner.close();
        process.stdout.write(JSON.stringify({ contract,  available:owner.status().available, closed:{executionStopConfirmed:owner.status().state==='closed'} }));
      } finally {
        await owner.close();
        childProcess.spawn=spawnBackend;
      }
    })().catch(error => {
      const code = typeof error?.code==='string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'UNCLASSIFIED_COMPUTER_FAILURE';
      process.stderr.write(JSON.stringify({stage:'packaged-computer-failure',code,name:error?.name,issues:error?.issues?.map(issue=>({code:issue.code,path:issue.path}))})+'\\n');
      process.exitCode = 1;
    });
  `;
    const result = await command(
      join(resource, 'resources/node/node.exe'),
      [
        '--eval',
        script,
        join(resource, 'runtime/computer-backend.cjs'),
        join(resource, 'runtime/computer-runtime.cjs'),
        resource,
      ],
      50000,
      { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: system32 }
    );
    assert.deepEqual(JSON.parse(result.split(/\r?\n/).find((line) => line.startsWith('{"contract":'))), {
      contract: true,
      available: false,
      closed: { executionStopConfirmed: true },
    });
    await verifyRuntimeManifest(
      product,
      JSON.parse(await readFile(join(product, 'runtime-manifest.json'), 'utf8'))
    );
    console.info(
      result
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{"stage":'))
        .join('\n')
    );
  }
);

test(
  'packaged stdio, network HTTP, IPC, system PowerShell, private Node/npm, fd and rg work with system-only PATH',
  { timeout: 600000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-package-fixture-'));
    const startedAt = performance.now();
    /**
     * Records phase timing only; configuration, tool arguments and credentials stay private.
     */
    const record = (stage) =>
      console.info(JSON.stringify({ stage, elapsedMs: performance.now() - startedAt }));
    let app;
    let client;
    let remoteClient;
    try {
      const clone = join(root, 'application');
      record('packaged-clone-start');
      await cp(product, clone, { recursive: true });
      record('packaged-clone-complete');
      // A disposable test copy enables only the inspector required by Playwright. The release executable is never modified.
      await flipFuses(join(clone, 'Dr.Octopus Executor.exe'), {
        version: FuseVersion.V1,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
      });
      // Keep automatic Host setup inside this disposable fixture; never migrate the user's registration.
      await writeFile(
        join(clone, 'resources/executor/setup/register-browser-host.ps1'),
        'param($Mode, $ResourceRoot, $ProjectRoot, [switch]$MigrateProduct)\r\nexit 0\r\n'
      );
      const data = join(root, 'data');
      const workspace = join(root, 'workspace');
      const configPath = join(root, 'connection.json');
      await mkdir(data);
      await mkdir(workspace);
      const address = Object.values(networkInterfaces())
        .flat()
        .find(
          (item) =>
            item &&
            !item.internal &&
            item.family === 'IPv4' &&
            networkAddressSchema.safeParse(item.address).success
        )?.address;
      assert.ok(address, 'Packaged network validation requires an assigned private/VPN IPv4 address.');
      const port = await isolatedPort(data, address);
      record('packaged-electron-launch');
      app = await electron.launch({
        executablePath: join(clone, 'Dr.Octopus Executor.exe'),
        args: ['--user-data-dir=' + data],
        env: { ...process.env, PATH: system32, NODE_OPTIONS: '' },
        timeout: 30000,
      });
      const page = await app.firstWindow();
      record('packaged-main-window');
      try {
        await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor({ timeout: 30000 });
      } catch (error) {
        const status = await page.evaluate(() => window.executor.readStatus());
        throw new Error('Packaged Runtime state: ' + status.data?.state + '; ' + status.data?.message, {
          cause: error,
        });
      }
      assert.equal(await page.title(), `Dr.Octopus Executor v${executorProduct.version}`);
      record('packaged-runtime-ready');
      assert.equal(await app.evaluate(({ app }) => app.getName()), 'Dr.Octopus Executor');
      assert.equal(await app.evaluate(({ app }) => app.getVersion()), executorProduct.version);
      assert.equal(
        await app.evaluate(async ({ app }) => (await app.getFileIcon(process.execPath)).isEmpty()),
        false
      );
      const status = await page.evaluate(() => window.executor.readStatus());
      assert.equal(status.data.state, 'ready');
      assert.equal(await page.locator('footer').count(), 0);
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      const help = page.getByRole('button', { name: '安装与连接说明', exact: true });
      assert.equal(await help.getAttribute('aria-expanded'), 'false');
      if (process.env.EXECUTOR_PACKAGE_CAPTURE_DIR) {
        await mkdir(process.env.EXECUTOR_PACKAGE_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: join(process.env.EXECUTOR_PACKAGE_CAPTURE_DIR, 'executor-packaged-collapsed.png'),
        });
      }
      await help.click();
      await page.getByRole('tab', { name: '本地安装', exact: true }).waitFor();
      if (process.env.EXECUTOR_PACKAGE_CAPTURE_DIR) {
        await page.screenshot({
          path: join(process.env.EXECUTOR_PACKAGE_CAPTURE_DIR, 'executor-packaged-installation.png'),
        });
      }
      assert.equal(
        await page
          .getByRole('group', { name: '选择浏览器' })
          .locator('img')
          .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
        true
      );
      await help.click();
      await app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((window) =>
          window.getTitle().startsWith('Dr.Octopus Executor')
        );
        window.show();
        const minimized = new Promise((resolve) => window.once('minimize', resolve));
        window.close();
        await minimized;
        window.restore();
      });
      assert.equal((await page.evaluate(() => window.executor.readStatus())).data.pid, status.data.pid);
      await expect
        .poll(
          () =>
            page.evaluate(
              async () => (await window.executor.readStatus()).data?.capabilities.computer.available
            ),
          { timeout: 45000 }
        )
        .toBe(true);
      assert.equal(
        (await page.evaluate(() => window.executor.readStatus())).data.capabilities.computer.state,
        'ready'
      );
      const live = (await page.evaluate(() => window.executor.readAccess())).data;
      assert.equal(live.remoteEndpoint, `http://${address}:${port}/mcp`);
      assert.equal((await fetch(live.remoteEndpoint)).status, 401);
      assert.equal((await fetch(live.remoteEndpoint.replace('/mcp', '/browser-bridge'))).status, 404);
      const diagnostics = await page.evaluate(() => window.executor.browserDiagnostics());
      assert.equal(diagnostics.ok, true);
      assert.equal(diagnostics.data.resourceRoot, join(clone, 'resources/executor'));
      assert.equal(diagnostics.data.resourcesAvailable, true);
      const enabled = await page.evaluate(() => window.executor.setBrowserEnabled({ enabled: true }));
      record('packaged-bridge-enabled');
      assert.equal(enabled.ok, true, JSON.stringify(enabled));
      await writeFile(
        join(clone, 'resources/executor/bridge/host-location.json'),
        JSON.stringify({ projectRoot: join(data, 'project') })
      );
      const host = spawn(
        join(clone, 'resources/executor/native/browser-launcher.exe'),
        [
          `chrome-extension://${JSON.parse(await readFile(join(product, 'resources/executor/browser-identity.json'), 'utf8')).identity.chromeExtensionId}/`,
        ],
        {
          windowsHide: true,
          stdio: 'pipe',
          env: { ...process.env, PATH: system32, NODE_OPTIONS: '--require=missing-injection' },
        }
      );
      const hostExit = once(host, 'exit');
      record('packaged-host-handshake');
      const deadline = setTimeout(() => host.kill(), 10000);
      host.stderr.resume();
      try {
        await writeFrame(host.stdin, {
          type: 'hello',
          version: bridgeVersion,
          requestId: randomUUID(),
          installationId: randomUUID(),
          browser: 'chrome',
          tools: true,
          extensionVersion: JSON.parse(
            await readFile(join(product, 'resources/browser/chrome/manifest.json'), 'utf8')
          ).version,
        });
        const reply = await readFrames(host.stdout)[Symbol.asyncIterator]().next();
        assert.equal(reply.value.type, 'connected');
        assert.equal(reply.value.version, bridgeVersion);
        host.stdin.end();
        assert.equal((await hostExit)[0], 0);
      } finally {
        clearTimeout(deadline);
        if (host.exitCode === null) {
          host.kill();
          await hostExit;
        }
      }
      await app.evaluate(
        ({ dialog }, values) => {
          dialog.showOpenDialog = async () => {
            throw new Error('Device authorization must not open a workspace picker.');
          };
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.configPath });
        },
        { workspace, configPath }
      );
      record('packaged-device-approval');
      const approval = await createClientConfiguration(page, {
        transport: 'stdio',
        label: 'Package fixture',
        permissions: ['files.write', 'shell.execute'],
        waitBudgetMs: 610000,
      });
      assert.equal(approval.ok, true);
      const config = JSON.parse(await readFile(configPath, 'utf8')).mcpServers[
        deviceConnectionKey(live.device)
      ];
      client = new Client({ name: 'packaged-acceptance', version: '1' });
      await client.connect(
        new StdioClientTransport({
          ...config,
          env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, PATH: system32 },
          stderr: 'pipe',
        })
      );
      assert.equal(client.getServerVersion().version, executorProduct.version);
      record('packaged-stdio-ready');
      /**
       * Checks real SDK envelopes while retaining useful domain failure diagnostics.
       */
      async function call(name, args) {
        record('packaged-tool-' + name);
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true, JSON.stringify(result));
        return result.structuredContent.data;
      }
      const task = await call('task_start', {
        cwd: workspace,
        capabilities: ['files.write', 'shell.execute'],
        idempotencyKey: 'packaged-task',
      });
      await call('write', {
        taskId: task.taskId,
        path: 'proof.txt',
        content: 'offline package',
        expectedVersion: 'absent',
        idempotencyKey: 'packaged-write',
      });
      assert.equal((await call('read', { taskId: task.taskId, path: 'proof.txt' })).text, 'offline package');
      assert.equal((await call('find', { taskId: task.taskId, pattern: '*.txt' })).entries.length, 1);
      assert.equal((await call('grep', { taskId: task.taskId, pattern: 'offline' })).entries.length, 1);
      await call('write', {
        taskId: task.taskId,
        path: 'package.json',
        content: JSON.stringify({
          name: 'packaged-offline-fixture',
          version: '1.0.0',
          private: true,
          scripts: {
            postinstall: `node -e "require('node:fs').writeFileSync('npm-runtime.txt',process.execPath)"`,
          },
        }),
        expectedVersion: 'absent',
        idempotencyKey: 'packaged-npm-fixture',
      });
      assert.equal(
        (
          await call('powershell', {
            taskId: task.taskId,
            command:
              "[Console]::Write('packaged'); node --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npx.cmd --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd install --offline --no-package-lock; exit $LASTEXITCODE",
            idempotencyKey: 'packaged-powershell',
          })
        ).exitCode,
        0
      );
      assert.equal(
        (await readFile(join(workspace, 'npm-runtime.txt'), 'utf8')).toLowerCase(),
        join(clone, 'resources/executor/resources/node/node.exe').toLowerCase()
      );
      await call('task_end', { taskId: task.taskId });
      await client.close();
      client = null;
      const remoteConfigPath = join(root, 'network.json');
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      }, remoteConfigPath);
      const remoteApproval = await createClientConfiguration(page, {
        transport: 'remote-http',
        label: 'packaged remote',
        permissions: ['files.read'],
        waitBudgetMs: 120000,
      });
      assert.equal(remoteApproval.ok, true);
      const remoteConfig = JSON.parse(await readFile(remoteConfigPath, 'utf8')).mcpServers[
        deviceConnectionKey(live.device)
      ];
      assert.equal(remoteConfig.url, live.remoteEndpoint);
      remoteClient = new Client({ name: 'packaged-network-validation', version: '1' });
      await remoteClient.connect(
        new StreamableHTTPClientTransport(new URL(remoteConfig.url), {
          requestInit: { headers: remoteConfig.headers },
        })
      );
      const started = await remoteClient.callTool({
        name: 'task_start',
        arguments: { cwd: workspace, capabilities: ['files.read'], idempotencyKey: 'packaged-network' },
      });
      assert.notEqual(started.isError, true);
      const remoteTaskId = started.structuredContent.data.taskId;
      const read = await remoteClient.callTool({
        name: 'read',
        arguments: { taskId: remoteTaskId, path: 'proof.txt' },
      });
      assert.equal(read.structuredContent.data.text, 'offline package');
      await remoteClient.callTool({ name: 'task_end', arguments: { taskId: remoteTaskId } });
      await remoteClient.close();
      remoteClient = null;
      const pid = status.data.pid;
      await app.close();
      app = null;
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      await assert.rejects(fetch(live.remoteEndpoint));
    } finally {
      record('packaged-cleanup-start');
      if (client) {
        await client.close();
      }
      await remoteClient?.close();
      if (app) {
        await app.close();
      }
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-package-fixture-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      record('packaged-cleanup-complete');
    }
  }
);

test(
  'unaltered hardened release starts its Runtime with Node injection ignored',
  { timeout: 60000 },
  async (context) => {
    if (process.env.EXECUTOR_INSTALL_ACCEPTANCE !== '1') {
      context.skip(
        'Unmodified startup can migrate Browser Host registrations; use the dedicated Windows test computer.'
      );
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'octopus-package-blackbox-'));
    const startedAt = performance.now();
    /**
     * Keeps protocol readiness separate from cleanup timing without relaxing either deadline.
     */
    const record = (stage) =>
      console.info(JSON.stringify({ stage, elapsedMs: performance.now() - startedAt }));
    const selectedPort = await isolatedPort(root);
    record('hardened-release-launch');
    const child = spawn(executable, ['--user-data-dir=' + root], {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: system32,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--require=missing-injection',
      },
    });
    const exited = once(child, 'exit');
    try {
      let ready = false;
      const readyDeadline = performance.now() + 45000;
      while (performance.now() < readyDeadline && child.exitCode === null) {
        try {
          const response = await fetch(`http://127.0.0.1:${selectedPort}/mcp`, {
            signal: AbortSignal.timeout(200),
          });
          if (response.status === 401) {
            ready = true;
            break;
          }
        } catch (error) {
          if (!(error instanceof Error)) {
            throw error;
          }
        }
        await delay(100);
      }
      assert.equal(ready, true);
      record('hardened-release-mcp-ready');
      assert.equal(child.exitCode, null);
    } finally {
      record('hardened-release-cleanup-start');
      if (child.exitCode === null) {
        await command(join(system32, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F']);
      }
      await exited;
      record('hardened-release-process-exited');
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-package-blackbox-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      record('hardened-release-cleanup-complete');
    }
  }
);

test(
  'actual per-user installer registers both browsers and uninstall preserves user data',
  { timeout: 300000 },
  async (context) => {
    if (process.env.EXECUTOR_INSTALL_ACCEPTANCE !== '1') {
      context.skip('Install/uninstall acceptance is reserved for the dedicated Windows test computer.');
      return;
    }
    const powershell = join(system32, 'WindowsPowerShell/v1.0/powershell.exe');
    const root = await mkdtemp(join(tmpdir(), 'octopus-package-install-'));
    const installation = join(root, 'installed');
    const keys = [
      'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.octopus.executor.browser',
      'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.octopus.executor.browser',
    ];
    const data = join(process.env.APPDATA, 'Octopus Executor');
    /**
     * Uses only fixed test-owned PowerShell arguments; no credentials enter command output.
     */
    async function ps(script) {
      return command(powershell, ['-NoProfile', '-NonInteractive', '-Command', script]);
    }
    assert.equal(
      await ps(
        `$keys=@('${keys.join("','")}'); if(@($keys | Where-Object {Test-Path -LiteralPath $_}).Count -or (Test-Path -LiteralPath '${data}')){exit 2}`
      ),
      ''
    );
    const installer = join(output, basename(artifact.files.find((file) => file.path.endsWith('.exe')).path));
    try {
      await command(installer, ['/S', '/D=' + installation]);
      const expected = join(installation, 'resources/executor/bridge/native-host.json');
      for (const key of keys) {
        assert.equal(await ps(`(Get-Item -LiteralPath '${key}').GetValue('')`), expected);
      }
      await command(join(installation, 'Uninstall Dr.Octopus Executor.exe'), ['/S', '_?=' + installation]);
      assert.equal(
        await ps(
          `$keys=@('${keys.join("','")}'); if(@($keys | Where-Object {Test-Path -LiteralPath $_}).Count){exit 3}; if(!(Test-Path -LiteralPath '${data}')){exit 4}`
        ),
        ''
      );
    } finally {
      // Production data did not exist before the fixture. Remove only its still-empty directory, never recovery files.
      await ps(`if(Test-Path -LiteralPath '${data}'){Remove-Item -LiteralPath '${data}' -ErrorAction Stop}`);
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-package-install-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
