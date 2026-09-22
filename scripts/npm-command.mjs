/**
 * @author Codex
 * @description Resolves npm's executable without passing Windows arguments through a shell.
 */
import { dirname, join } from 'node:path';
import { execute } from '../apps/cli/src/process.ts';

/**
 * Resolves npm's JS entry on Windows so arguments never pass through cmd.exe quoting.
 * @param {string} cwd Directory used to probe for the npm shim.
 * @returns {Promise<{command: string, args: string[]}>}
 */
export async function npmCommand(cwd) {
  if (process.platform !== 'win32') {
    return { command: 'npm', args: [] };
  }
  const { access } = await import('node:fs/promises');
  const paths = (await execute('where.exe', ['npm'], cwd)).split(/\r?\n/);
  for (const path of paths) {
    for (const entry of [
      join(dirname(path), 'node_modules/npm/bin/npm-cli.js'),
      join(dirname(path), 'npm-cli.js'),
    ]) {
      try {
        await access(entry);
        return { command: process.execPath, args: [entry] };
      } catch {
        /* Try the next standard npm shim layout. */
      }
    }
    if (path.endsWith('.exe')) {
      return { command: path, args: [] };
    }
  }
  throw new Error('npm was not found. Install Node.js 22.19+, which bundles npm.');
}
