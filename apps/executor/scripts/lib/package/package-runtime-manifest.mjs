/**
 * @author Codex
 * @description Collects actual fixed component versions and release metadata after final PE/fuse editing; no download, task dispatch, system runtime fallback or product registration occurs.
 */
import { applicationApi } from '../compile/application-api.mjs';
const { executorProduct } = applicationApi;
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { createRuntimeManifest, releaseMetadataSchema, runtimeManifestPath } from './runtime-manifest.mjs';

const run = promisify(execFile);
const pinnedVersionSchema = z.object({ version: z.string().min(1) });
/**
 * Removes only the version probe's known temporary prefix, independently of success or failure of version collection.
 */
async function cleanupVersionProbe(data, prefix) {
  if (!resolve(data).startsWith(prefix)) {
    throw new Error('Version probe cleanup path invalid.');
  }
  await rm(data, { recursive: true, force: true });
}
/**
 * Executes only explicit version commands in fixed product directories with a bounded output/deadline and no inherited runtime loader options.
 */
async function versionCommand(file, args, cwd) {
  const windows = process.env.SystemRoot;
  const result = await run(file, args, {
    cwd,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 16384,
    env: {
      SystemRoot: windows,
      WINDIR: windows,
      HOME: cwd,
      USERPROFILE: cwd,
      PATH: join(windows, 'System32'),
      TEMP: tmpdir(),
      TMP: tmpdir(),
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });
  return result.stdout.trim();
}
/**
 * Reads the actual npm version using empty owned configuration files instead of a developer's npm credentials.
 */
async function npmVersion(node, cli) {
  const prefix = resolve(tmpdir(), 'octopus-build-npm-');
  const data = await mkdtemp(prefix);
  try {
    const user = join(data, 'user.conf');
    const global = join(data, 'global.conf');
    await writeFile(user, '', { flag: 'wx' });
    await writeFile(global, '', { flag: 'wx' });
    return await versionCommand(
      node,
      [cli, '--version', '--userconfig=' + user, '--globalconfig=' + global],
      data
    );
  } finally {
    await cleanupVersionProbe(data, prefix);
  }
}
/**
 * Inspects the bundled build-time Electron runtime and removes only this invocation's validated temporary directory.
 */
async function electronVersions(root) {
  const require = createRequire(import.meta.url);
  const executable = join(dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
  const prefix = resolve(tmpdir(), 'octopus-build-versions-');
  const data = await mkdtemp(prefix);
  try {
    const output = await versionCommand(
      executable,
      [join(root, 'scripts/lib/package/inspect-electron.cjs'), data],
      root
    );
    const line = output.split(/\r?\n/).find((value) => value.startsWith('EXECUTOR_BUILD_VERSIONS='));
    if (!line) {
      throw new Error('Electron component versions unavailable.');
    }
    return releaseMetadataSchema.shape.components.shape.electron.parse(
      JSON.parse(line.slice('EXECUTOR_BUILD_VERSIONS='.length))
    );
  } finally {
    await cleanupVersionProbe(data, prefix);
  }
}
/**
 * Generates the installed manifest from the final packaged bytes before installer/ZIP creation; existing outputs are never replaced.
 */
export async function packageRuntimeManifest(root, product) {
  const resource = join(product, 'resources/executor');
  const nodePin = pinnedVersionSchema.parse(
    JSON.parse(await readFile(join(root, 'vendor/browser-node.json'), 'utf8'))
  );
  const searchPin = z
    .object({ fd: pinnedVersionSchema, rg: pinnedVersionSchema })
    .parse(JSON.parse(await readFile(join(root, 'vendor/search-tools.json'), 'utf8')));
  const computerPin = z
    .object({
      python: pinnedVersionSchema,
      windowsMcp: z.object({ version: z.string(), commit: z.string() }),
    })
    .parse(JSON.parse(await readFile(join(root, 'vendor/windows-mcp.json'), 'utf8')));
  const paths = {
    application: 'Dr.Octopus Executor.exe',
    appAsar: 'resources/app.asar',
    runtime: 'resources/executor/runtime/index.cjs',
    node: 'resources/executor/resources/node/node.exe',
    npm: 'resources/executor/resources/node/node_modules/npm/bin/npm-cli.js',
    npx: 'resources/executor/resources/node/node_modules/npm/bin/npx-cli.js',
    nodeInventory: 'resources/executor/node-resources.json',
    python: 'resources/executor/resources/computer/python.exe',
    processSupervisor: 'resources/executor/native/process-supervisor.exe',
    fd: 'resources/executor/resources/search/fd/fd.exe',
    rg: 'resources/executor/resources/search/rg/rg.exe',
    mcpLauncher: 'resources/executor/native/mcp-launcher.exe',
    browserLauncher: 'resources/executor/native/browser-launcher.exe',
    browserIdentity: 'resources/executor/browser-identity.json',
    computerSupervisor: 'resources/executor/native/computer-supervisor.exe',
    computerBackend: 'resources/executor/resources/computer/product/server.py',
    computerGuard: 'resources/executor/resources/computer/product/desktop.py',
  };
  const components = {
    electron: await electronVersions(root),
    privateNode: (await versionCommand(join(product, paths.node), ['--version'], product)).replace(/^v/, ''),
    npm: await npmVersion(join(product, paths.node), join(product, paths.npm)),
    privatePython: (
      await versionCommand(join(product, paths.python), ['-I', '-S', '--version'], product)
    ).replace(/^Python /, ''),
    systemShell: { kind: 'powershell', versionFamily: '5.1', source: 'operating-system' },
    fd: (await versionCommand(join(product, paths.fd), ['--version'], product)).replace(/^fd /, ''),
    rg: (await versionCommand(join(product, paths.rg), ['--version'], product))
      .split(/\r?\n/)[0]
      .replace(/^ripgrep /, ''),
    pageController: '1.12.4',
    windowsMcp: computerPin.windowsMcp,
  };
  const sourcePackage = z
    .object({ devDependencies: z.object({ electron: z.string() }) })
    .parse(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')));
  if (
    components.electron.version !== sourcePackage.devDependencies.electron ||
    components.privateNode !== nodePin.version ||
    components.npm !== '11.19.0' ||
    components.privatePython !== computerPin.python.version ||
    components.fd !== searchPin.fd.version ||
    components.rg.split(' ')[0] !== searchPin.rg.version
  ) {
    throw new Error(
      'Packaged component versions do not match fixed baselines: ' + JSON.stringify(components)
    );
  }
  const schemaPath = 'resources/executor/validation-schemas.json';
  const schemas = z
    .object({
      schemas: z.object({
        basic: z.record(z.string(), z.unknown()),
        browser: z.record(z.string(), z.unknown()),
        control: z.record(z.string(), z.unknown()),
        computerPrepared: z.record(z.string(), z.unknown()),
      }),
    })
    .parse(JSON.parse(await readFile(join(product, schemaPath), 'utf8')));
  const schemaFiles = [schemaPath, 'resources/executor/resources/computer/product/schemas.json'];
  const schemaRecords = [];
  for (const path of schemaFiles) {
    schemaRecords.push({
      path,
      sha256: createHash('sha256')
        .update(await readFile(join(product, path)))
        .digest('hex'),
    });
  }
  // All additional dependency notices are also included in the complete files inventory.
  const licenses = [
    'LICENSE.electron.txt',
    'LICENSES.chromium.html',
    'third-party-licenses/inventory.json',
    'resources/executor/resources/node/LICENSE',
    'resources/executor/resources/node/node_modules/npm/LICENSE',
    'resources/browser/chrome/licenses/page-controller-1.12.4.txt',
    'resources/browser/edge/licenses/page-controller-1.12.4.txt',
  ];
  const metadata = releaseMetadataSchema.parse({
    product: { name: executorProduct.name, version: executorProduct.version },
    platform: 'win32',
    arch: 'x64',
    components,
    entries: paths,
    schemas: schemaRecords,
    licenses,
    basicBuildId: createHash('sha256')
      .update(await readFile(join(resource, 'runtime/index.cjs')))
      .digest('hex'),
    tools: Object.fromEntries(
      ['basic', 'browser', 'control', 'computerPrepared'].map((name) => [
        name,
        Object.keys(schemas.schemas[name]).sort(),
      ])
    ),
    availability: {
      computerEnabled: true,
      browserRequiresConnectionAndGrant: true,
      shellNode: true,
      npmBundled: true,
    },
  });
  const manifest = await createRuntimeManifest(product, metadata);
  await writeFile(join(product, runtimeManifestPath), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest.productBuildId;
}
