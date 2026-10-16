/**
 * @author Codex
 * @description Emits separate Main, sandbox Preload and Utility Runtime artifacts before the Renderer.
 */
import { build as bundle } from 'esbuild';
import { executorTarget } from '../lib/platform.mjs';
import { build as buildRenderer } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildNative } from './build-native.mjs';
import { publishComputerProduct } from '../lib/compile/computer-product.mjs';
import { buildComputerInventory } from '../lib/resources/computer-inventory.mjs';
import { emitValidationSchemas } from '../lib/compile/emit-validation-schemas.mjs';
import { buildNodeInventory } from '../lib/resources/node-inventory.mjs';
import { loadBrowserIdentity } from '../../../browser-extension/scripts/lib/browser-identity.mjs';
import { writeBuiltBrowserIdentity } from '../lib/compile/browser-identity.mjs';
/**
 * Builds executable JavaScript with an explicit loading format per process.
 */
export async function buildProcesses() {
  executorTarget();
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const browserIdentity = loadBrowserIdentity();
  await mkdir(join(root, 'dist/assets/brand'), { recursive: true });
  await copyFile(join(root, 'assets/brand/app.ico'), join(root, 'dist/assets/brand/app.ico'));
  await buildNative(browserIdentity);
  const computer = join(root, 'dist', 'resources', 'computer');
  let computerResources = false;
  try {
    await stat(join(computer, 'python.exe'));
    await publishComputerProduct(root, computer);
    computerResources = true;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
  await mkdir(join(root, 'dist', 'native'), { recursive: true });
  await copyFile(
    join(root, 'build', 'native', 'stdio-exit.node'),
    join(root, 'dist', 'native', 'stdio-exit.node')
  );
  await copyFile(
    join(root, 'build', 'native', 'computer-escape.node'),
    join(root, 'dist', 'native', 'computer-escape.node')
  );
  await mkdir(join(root, 'dist', 'setup'), { recursive: true });
  await copyFile(
    join(root, 'build', 'setup', 'register-browser-host.ps1'),
    join(root, 'dist', 'setup', 'register-browser-host.ps1')
  );
  await copyFile(
    join(root, 'build', 'native', 'file-commit.node'),
    join(root, 'dist', 'native', 'file-commit.node')
  );
  await copyFile(
    join(root, 'build', 'native', 'process-supervisor.exe'),
    join(root, 'dist', 'native', 'process-supervisor.exe')
  );
  await copyFile(
    join(root, 'build', 'native', 'browser-launcher.exe'),
    join(root, 'dist', 'native', 'browser-launcher.exe')
  );
  await copyFile(
    join(root, 'build', 'native', 'computer-supervisor.exe'),
    join(root, 'dist', 'native', 'computer-supervisor.exe')
  );
  await copyFile(
    join(root, 'build', 'native', 'mcp-launcher.exe'),
    join(root, 'dist', 'native', 'mcp-launcher.exe')
  );
  if (computerResources) {
    await buildComputerInventory(root);
  }
  const nodeHash = await buildNodeInventory(root);
  await emitValidationSchemas(join(root, 'dist/validation-schemas.json'));
  await Promise.all([
    bundle({
      absWorkingDir: root,
      entryPoints: ['src/bridge/mcp-stdio.ts'],
      outfile: 'dist/bridge/mcp-stdio.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      sourcemap: false,
    }),
    bundle({
      absWorkingDir: root,
      entryPoints: ['src/runtime/computer/computer-backend.ts'],
      outfile: 'dist/runtime/computer-backend.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      sourcemap: false,
    }),
    bundle({
      absWorkingDir: root,
      entryPoints: ['src/runtime/computer/computer-runtime.ts'],
      outfile: 'dist/runtime/computer-runtime.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      sourcemap: false,
    }),
    bundle({
      absWorkingDir: root,
      entryPoints: ['src/bridge/native-host.ts'],
      outfile: 'dist/bridge/native-host.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      sourcemap: false,
    }),
    bundle({
      absWorkingDir: root,
      entryPoints: ['src/main/index.ts'],
      outfile: 'dist/main/index.js',
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      external: ['electron'],
      sourcemap: false,
    }),
    bundle({
      absWorkingDir: root,
      entryPoints: ['src/preload/index.ts'],
      outfile: 'dist/preload/index.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      external: ['electron'],
      sourcemap: false,
    }),
    bundle({
      absWorkingDir: root,
      entryPoints: ['src/runtime/index.ts'],
      outfile: 'dist/runtime/index.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      sourcemap: false,
      define: { NODE_RESOURCE_HASH: JSON.stringify(nodeHash) },
    }),
  ]);
  await writeBuiltBrowserIdentity(browserIdentity);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildProcesses();
  await buildRenderer({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)) });
}
