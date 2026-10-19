/**
 * @author Codex
 * @description Packages only built product artifacts and fixed private resources into an unsigned offline Windows acceptance installer and ZIP.
 */
import { executorTarget } from '../lib/platform.mjs';
import { applicationApi } from '../lib/compile/application-api.mjs';
const { NodeResources, NativeFileCommit, executorProduct } = applicationApi;
import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { computerInventorySchema } from '../lib/resources/computer-manifest.mjs';

import { packageLicenses } from '../lib/package/package-licenses.mjs';

import { prepareAcceptanceKit } from './prepare-acceptance-kit.mjs';
import { packageRuntimeManifest } from '../lib/package/package-runtime-manifest.mjs';
import { loadBrowserIdentity } from '../../../browser-extension/scripts/lib/browser-identity.mjs';
import {
  verifyBuiltBrowserIdentity,
  verifyBundledBrowserExtensions,
} from '../lib/compile/browser-identity.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
/**
 * Allows a trusted build invocation to place new artifacts on a disk with enough space.
 * Runtime configuration and existing artifacts are unaffected.
 */
function artifactRoot() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return join(root, 'release');
  }
  if (args.length !== 2 || args[0] !== '--output-root' || !args[1]?.trim()) {
    throw new Error('Usage: package:acceptance [--output-root <directory>]');
  }
  return resolve(args[1]);
}
/**
 * Anchors emitted artifacts and prepared resources to their exact bytes.
 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
/**
 * Requires the explicitly prepared, digest-checked tool cache and disables automatic tool acquisition paths.
 */
async function prepareTools() {
  const cache = z
    .strictObject({
      builder: z.literal('26.15.3'),
      records: z
        .array(
          z.strictObject({
            name: z.enum(['nsis', 'rcedit', 'sevenZip']),
            directory: z.string(),
            files: z
              .array(z.strictObject({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }))
              .min(1),
          })
        )
        .length(3)
        .refine((records) => new Set(records.map((record) => record.name)).size === 3),
    })
    .parse(JSON.parse(await readFile(join(root, 'build/packaging-tools.json'), 'utf8')));
  for (const tool of cache.records) {
    for (const file of tool.files) {
      const target = resolve(tool.directory, file.path);
      if (
        !target.startsWith(resolve(tool.directory) + '\\') ||
        !(await lstat(target)).isFile() ||
        sha256(await readFile(target)) !== file.sha256
      ) {
        throw new Error('Packaging cache invalid; explicitly run assemble:packaging.');
      }
    }
    if (tool.name === 'nsis') {
      process.env.ELECTRON_BUILDER_NSIS_DIR = tool.directory;
      process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR = tool.directory;
    } else if (tool.name === 'rcedit') {
      process.env.ELECTRON_BUILDER_RCEDIT_PATH = tool.directory;
    } else {
      process.env.ELECTRON_BUILDER_7ZIP_PATH = join(tool.directory, '7za.exe');
    }
  }
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = '1';
}
/**
 * Copies fixed build directories without recovery material, registration locators, links or source maps.
 */
async function copyProduct(source, target) {
  await cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async (path) => {
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new Error('Product resources must not contain symbolic links.');
      }
      return !/(?:^|[\\/])(?:__pycache__|\.octopus[^\\/]*|host-location\.json|native-host\.json)(?:[\\/]|$)|\.(?:map|pyc|bak)$/.test(
        path
      );
    },
  });
}
/**
 * Produces a versioned, separate output; no source package dependencies or development commands enter app.asar.
 */
async function packageAcceptance() {
  const outputRoot = artifactRoot();
  executorTarget();
  const browserClient = await verifyBuiltBrowserIdentity(loadBrowserIdentity());
  await verifyBundledBrowserExtensions(browserClient);
  await prepareTools();
  const sourcePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const { version } = executorProduct;
  if (sourcePackage.version !== version) {
    throw new Error('Workspace and product versions must match.');
  }
  const stage = join(tmpdir(), `octopus-package-${randomUUID()}`);
  const app = join(stage, 'app');
  const resources = join(stage, 'executor');
  await mkdir(app, { recursive: true });
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: 'octopus-executor',
        productName: executorProduct.name,
        version,
        type: 'module',
        main: 'dist/main/index.js',
        description: 'Local MCP tool executor — unsigned acceptance build',
        author: 'Octopus',
      },
      null,
      2
    )
  );
  for (const name of ['main', 'preload', 'renderer']) {
    await copyProduct(join(root, 'dist', name), join(app, 'dist', name));
  }
  for (const name of ['native', 'runtime', 'bridge', 'setup', 'assets']) {
    await copyProduct(join(root, 'dist', name), join(resources, name));
  }
  for (const name of ['node', 'search']) {
    await copyProduct(join(root, 'dist/resources', name), join(resources, 'resources', name));
  }
  await cp(join(root, 'dist/node-resources.json'), join(resources, 'node-resources.json'));
  await cp(join(root, 'dist/browser-identity.json'), join(resources, 'browser-identity.json'));
  await NodeResources.open(
    resources,
    new NativeFileCommit(join(resources, 'native/file-commit.node')),
    await readFile(join(root, 'build/node-resources.hash'), 'utf8')
  );
  const required = [
    'assets/brand/app.ico',
    'native/file-commit.node',
    'native/stdio-exit.node',
    'native/computer-escape.node',
    'native/mcp-launcher.exe',
    'native/browser-launcher.exe',
    'native/process-supervisor.exe',
    'bridge/native-host.cjs',
    'bridge/mcp-stdio.cjs',
    'resources/node/node.exe',
    'resources/node/LICENSE',
    'resources/search/fd/fd.exe',
    'resources/search/rg/rg.exe',
  ];
  for (const name of required) {
    if (!(await lstat(join(resources, name))).isFile()) {
      throw new Error(`Missing product resource: ${name}`);
    }
  }
  if (
    sha256(await readFile(join(resources, 'resources/node/node.exe'))) !==
    '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5'
  ) {
    throw new Error('Private Node digest mismatch.');
  }
  const computer = computerInventorySchema.parse(
    JSON.parse(await readFile(join(root, 'dist/computer-resources.json'), 'utf8'))
  );
  for (const file of computer.files) {
    if (!file.path.startsWith('resources/computer/')) {
      continue;
    }
    const bytes = await readFile(join(root, 'dist', file.path));
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
      throw new Error('Computer product digest mismatch.');
    }
    await mkdir(dirname(join(resources, file.path)), { recursive: true });
    await writeFile(join(resources, file.path), bytes);
  }
  await cp(join(root, 'dist/computer-resources.json'), join(resources, 'computer-resources.json'));
  await cp(join(root, 'dist/validation-schemas.json'), join(resources, 'validation-schemas.json'));
  const extensionVersion = z
    .object({ version: z.string().min(1) })
    .parse(JSON.parse(await readFile(join(root, '../browser-extension/package.json'), 'utf8'))).version;
  for (const [browser, buildName] of Object.entries({ chrome: 'chrome-mv3', edge: 'edge-mv3' })) {
    const source = join(root, '../browser-extension/.output', buildName);
    const manifest = z
      .object({
        manifest_version: z.literal(3),
        version: z.literal(extensionVersion),
        action: z.object({ default_popup: z.literal('popup.html') }),
      })
      .parse(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')));
    for (const path of [
      manifest.action.default_popup,
      ...[16, 32, 48, 128].map((size) => `icons/icon-${size}.png`),
    ]) {
      if (!(await lstat(join(source, path))).isFile()) {
        throw new Error('Current extension popup/icon resource missing.');
      }
    }
    await copyProduct(source, join(stage, 'browser', browser));
  }
  await cp(join(root, '../browser-extension/INSTALLATION.md'), join(stage, 'browser/INSTALLATION.md'));
  await cp(join(root, 'INSTALLATION.md'), join(stage, 'INSTALLATION.md'));
  await packageLicenses(root, join(stage, 'third-party-licenses'));
  const output = join(outputRoot, `${version}-unsigned-${randomUUID()}`);
  let productBuildId = null;
  const artifacts = await build({
    projectDir: root,
    targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
    publish: 'never',
    config: {
      appId: 'com.octopus.executor',
      productName: executorProduct.name,
      directories: { app, output },
      electronVersion: sourcePackage.devDependencies.electron,
      electronDist: join(dirname(require.resolve('electron/package.json')), 'dist'),
      files: ['package.json', 'dist/**/*'],
      asar: true,
      // Every JavaScript dependency is bundled by esbuild/Vite; do not collect workspace node_modules.
      beforeBuild: async () => false,
      // This builder emits afterSign after PE resource editing even for signExecutable:false.
      // afterPack runs before fuses and PE editing, so its executable hash would be stale.
      afterSign: async (context) => {
        productBuildId = await packageRuntimeManifest(root, context.appOutDir);
      },
      extraResources: [
        { from: resources, to: 'executor' },
        { from: join(stage, 'browser'), to: 'browser' },
      ],
      extraFiles: [
        { from: join(stage, 'INSTALLATION.md'), to: 'INSTALLATION.md' },
        { from: join(stage, 'third-party-licenses'), to: 'third-party-licenses' },
      ],
      artifactName: 'Dr.Octopus-Executor-${version}-win-${arch}-unpacked-unsigned.${ext}',
      toolsets: { nsis: '1.2.1', winCodeSign: '1.1.0' },
      electronFuses: {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        grantFileProtocolExtraPrivileges: false,
      },
      win: {
        icon: join(root, 'assets/brand/app.ico'),
        signExecutable: false,
        requestedExecutionLevel: 'asInvoker',
      },
      nsis: {
        artifactName: 'Dr.Octopus-Executor-${version}-win-${arch}-setup-unsigned.${ext}',
        installerIcon: join(root, 'assets/brand/app.ico'),
        uninstallerIcon: join(root, 'assets/brand/app.ico'),
        oneClick: true,
        perMachine: false,
        allowElevation: false,
        packElevateHelper: false,
        runAfterFinish: false,
        deleteAppDataOnUninstall: false,
        differentialPackage: false,
        include: join(root, 'src/installation/windows/installer.nsh'),
      },
    },
  });
  const files = [];
  for (const path of artifacts) {
    const bytes = await readFile(path);
    files.push({ path: relative(output, path), size: bytes.length, sha256: sha256(bytes) });
  }
  await writeFile(
    join(output, 'acceptance-artifacts.json'),
    JSON.stringify(
      {
        productName: executorProduct.name,
        version,
        signed: false,
        computerEnabled: true,
        productBuildId,
        runtimeManifestSha256: sha256(await readFile(join(output, 'win-unpacked/runtime-manifest.json'))),
        files,
      },
      null,
      2
    )
  );
  await prepareAcceptanceKit(output);
  console.log(`Unsigned acceptance artifacts: ${output}`);
}
await packageAcceptance();
