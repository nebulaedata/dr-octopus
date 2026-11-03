/**
 * @author Codex
 * @description Prepares missing fixed resources, builds both products and packages a fresh unsigned Windows installer and ZIP.
 */
import { spawn } from 'node:child_process';
import { stat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { executorTarget } from '../lib/platform.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const repository = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Distinguishes missing resources from unreadable paths; existing resources retain their downstream integrity checks.
 */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Runs pnpm without shell interpolation and stops the pipeline on any failed or interrupted child.
 */
async function run(args) {
  const cli = process.env.npm_execpath;
  if (!cli) {
    throw new Error('Run this command through pnpm build:executor.');
  }
  console.log(`\n> pnpm ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repository,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pnpm ${args.join(' ')} failed (${signal ?? code}).`));
      }
    });
  });
}

/**
 * Acquires only absent resources, then builds shared dependencies, extension and client before packaging existing outputs.
 */
async function buildInstaller() {
  executorTarget();
  const { values } = parseArgs({ options: { 'output-root': { type: 'string' } } });
  if (values['output-root'] !== undefined && !values['output-root'].trim()) {
    throw new Error('--output-root must be a nonempty directory.');
  }
  const executor = ['--filter', '@octopus/executor'];
  await run(['exec', 'turbo', 'run', 'build', '--filter=@octopus/browser-extension']);
  if (!process.env.EXECUTOR_NODE_HEADERS) {
    const defaultHeaders = join(homedir(), 'AppData/Local/node-gyp/Cache/24.20.0');
    const localHeaders = join(root, 'build/node-headers-cache/node-v24.20.0');
    if (!(await exists(defaultHeaders)) && (await exists(localHeaders))) {
      process.env.EXECUTOR_NODE_HEADERS = localHeaders;
    } else if (!(await exists(defaultHeaders))) {
      const parent = join(root, 'build');
      await mkdir(parent, { recursive: true });
      const cache = join(parent, 'node-headers-cache');
      await run([...executor, 'assemble:node-headers', '--cache-dir', cache]);
      process.env.EXECUTOR_NODE_HEADERS = join(cache, 'node-v24.20.0');
    }
  }
  for (const [resource, command] of [
    ['dist/resources/node', 'assemble:node'],
    ['dist/resources/search', 'assemble:search'],
    ['dist/resources/computer', 'assemble:computer'],
  ]) {
    if (!(await exists(join(root, resource)))) {
      await run([...executor, command]);
    }
  }
  await run(['exec', 'turbo', 'run', 'build', '--filter=@octopus/executor']);
  if (!(await exists(join(root, 'build/packaging-tools.json')))) {
    await run([...executor, 'assemble:packaging']);
  }
  const output = values['output-root'];
  await run([...executor, 'package:acceptance', ...(output ? ['--output-root', output] : [])]);
}

await buildInstaller();
