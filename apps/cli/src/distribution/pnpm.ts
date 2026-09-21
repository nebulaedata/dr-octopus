/**
 * @author Codex
 * @description Resolves the bootstrap-owned pnpm installation without relying on global PATH or Corepack.
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execute, pnpmCommand } from '../process.js';
import { distribution, findConfiguration } from './location.js';
import { gatewayError } from '../gateway/index.js';

/**
 * Pins the package manager to the release contract and executes its JS entry using the running Node.
 */
export async function runtimePnpm() {
  const context = distribution();
  if (!context.packaged) {
    return pnpmCommand(context.root);
  }
  try {
    const require = createRequire(join(context.root, 'package.json'));
    const manifestPath = findConfiguration(dirname(require.resolve('pnpm')), 'package.json');
    if (!manifestPath) {
      throw new Error('pnpm package metadata is missing.');
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      name: string;
      version: string;
      bin: { pnpm: string };
    };
    if (manifest.name !== 'pnpm' || manifest.version !== context.layout.pnpmVersion) {
      throw new Error(`Expected pnpm ${context.layout.pnpmVersion}, found ${manifest.version}.`);
    }
    const args = [join(dirname(manifestPath), manifest.bin.pnpm)];
    const version = await execute(process.execPath, [...args, '--version'], context.root);
    if (version !== context.layout.pnpmVersion) {
      throw new Error('pnpm entry version does not match its manifest.');
    }
    return { command: process.execPath, args };
  } catch (error) {
    throw gatewayError(
      'PNPM_UNAVAILABLE',
      `Reinstall the ${context.layout.name} npm package to restore pnpm. ${String(error)}`
    );
  }
}
