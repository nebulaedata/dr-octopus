/**
 * @author Codex
 * @description Exercises the Windows offline preflight's corruption, path confinement, resource, and report preservation contracts without installing or launching a product.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const script = join(import.meta.dirname, 'packaging/offline-preflight.ps1');

/**
 * Builds non-executable deterministic files sufficient to verify preflight contracts, not product acceptance.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'octopus-preflight-'));
  const product = join(root, 'win-unpacked');
  const required = [
    'Dr.Octopus Executor.exe',
    'resources/executor/assets/brand/app.ico',
    'resources/app.asar',
    'INSTALLATION.md',
    'resources/executor/native/file-commit.node',
    'resources/executor/native/stdio-exit.node',
    'resources/executor/native/mcp-launcher.exe',
    'resources/executor/native/browser-launcher.exe',
    'resources/executor/native/process-supervisor.exe',
    'resources/executor/runtime/index.cjs',
    'resources/executor/bridge/native-host.cjs',
    'resources/executor/bridge/mcp-stdio.cjs',
    'resources/executor/setup/register-browser-host.ps1',
    'resources/executor/resources/node/node.exe',
    'resources/executor/resources/node/LICENSE',
    'resources/executor/resources/search/fd/fd.exe',
    'resources/executor/resources/search/rg/rg.exe',
    'resources/executor/computer-resources.json',
    'third-party-licenses/fixture@1.0.0/LICENSE',
    'third-party-licenses/%40fixture%2Ftest@2.0.0/LICENSE',
  ];
  for (const browser of ['chrome', 'edge']) {
    for (const name of [
      'background.js',
      'content-scripts/content.js',
      'licenses/page-controller-1.12.4.txt',
      'licenses/noble-hashes-1.8.0.txt',
    ]) {
      required.push(`resources/browser/${browser}/${name}`);
    }
  }
  for (const relative of required) {
    const path = join(product, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'non-executable fixture');
  }
  for (const browser of ['chrome', 'edge']) {
    await writeFile(
      join(product, `resources/browser/${browser}/manifest.json`),
      '{"manifest_version":3,"action":{"default_title":"Dr.Octopus 浏览器连接"}}'
    );
  }
  await writeFile(
    join(product, 'third-party-licenses/inventory.json'),
    JSON.stringify([
      { name: 'fixture', version: '1.0.0', notices: ['LICENSE'] },
      { name: '@fixture/test', version: '2.0.0', notices: ['LICENSE'] },
    ])
  );
  const bytes = Buffer.from('artifact fixture');
  const metadata = {
    productName: 'Dr.Octopus Executor',
    version: '0.9.7',
    signed: false,
    computerEnabled: true,
    files: [],
  };
  for (const path of ['fixture.exe', 'fixture.zip']) {
    await writeFile(join(root, path), bytes);
    metadata.files.push({
      path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  await writeFile(join(root, 'acceptance-artifacts.json'), JSON.stringify(metadata));
  return { root, product, metadata, report: join(root, 'report.json') };
}

/**
 * Uses Windows PowerShell 5.1 with system-only PATH and a bounded owned process, recording no credential content.
 */
async function check(values) {
  const child = spawn(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-ArtifactDirectory',
      values.root,
      '-ReportPath',
      values.report,
    ],
    {
      windowsHide: true,
      env: { ...process.env, PATH: join(process.env.SystemRoot, 'System32') },
      stdio: 'pipe',
    }
  );
  let output = '';
  child.stdout.on('data', (bytes) => {
    output += bytes;
  });
  child.stderr.on('data', (bytes) => {
    output += bytes;
  });
  const timer = setTimeout(() => child.kill(), 20000);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code, output }));
    });
  } finally {
    clearTimeout(timer);
  }
}

for (const scenario of [
  'valid',
  'corruption',
  'unsafe artifact path',
  'missing resource',
  'existing report',
  'mismatched product version',
]) {
  test(`offline preflight: ${scenario}`, { timeout: 30000 }, async () => {
    const values = await fixture();
    try {
      if (scenario === 'corruption') {
        await writeFile(join(values.root, 'fixture.zip'), 'changed contents');
      }
      if (scenario === 'unsafe artifact path') {
        values.metadata.files[0].path = '../outside.exe';
        await writeFile(join(values.root, 'acceptance-artifacts.json'), JSON.stringify(values.metadata));
      }
      if (scenario === 'missing resource') {
        await rm(join(values.product, 'resources/executor/resources/search/rg/rg.exe'));
      }
      if (scenario === 'existing report') {
        await writeFile(values.report, 'retain original evidence');
      }
      if (scenario === 'mismatched product version') {
        const manifest = JSON.stringify({
          schemaVersion: 1,
          productBuildId: 'a'.repeat(64),
          product: { name: values.metadata.productName, version: '0.9.8' },
        });
        await writeFile(join(values.product, 'runtime-manifest.json'), manifest);
        values.metadata.productBuildId = 'a'.repeat(64);
        values.metadata.runtimeManifestSha256 = createHash('sha256').update(manifest).digest('hex');
        await writeFile(join(values.root, 'acceptance-artifacts.json'), JSON.stringify(values.metadata));
      }
      const result = await check(values);
      if (scenario === 'existing report') {
        assert.notEqual(result.code, 0);
        assert.equal(await readFile(values.report, 'utf8'), 'retain original evidence');
        return;
      }
      const report = JSON.parse(await readFile(values.report, 'utf8'));
      assert.equal(result.code, scenario === 'valid' ? 0 : 1, result.output + JSON.stringify(report));
      assert.equal(report.preflightPassed, scenario === 'valid');
      assert.deepEqual(report.acceptance, { G4: 'pending', G5: 'pending', G6: 'pending' });
      if (scenario === 'valid') {
        assert.equal(report.licenseRecords, 2);
        assert.equal(report.environment.networkIsolation, 'not-verified-manual-evidence-required');
        assert.ok(report.environment.systemTools.every((tool) => tool.foundOnPath === false));
      }
    } finally {
      assert.ok(values.root.startsWith(join(tmpdir(), 'octopus-preflight-')));
      await rm(values.root, { recursive: true, force: true });
    }
  });
}
