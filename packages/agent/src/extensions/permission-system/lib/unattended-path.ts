/**
 * @author Codex
 * @description Resolves existing ancestors before unattended file tools cross the workspace boundary.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { PermissionGrantError } from '../definitions/grant.js';

/**
 * Resolve junctions and symlinks even for a new file below an existing directory.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    const parent = dirname(path);
    if (parent === path) {
      throw error;
    }
    return resolve(canonical(parent), basename(path));
  }
}

/**
 * Check built-in file arguments; shell tools remain explicit full shell capability, not a filesystem sandbox.
 */
export function checkUnattendedPath(cwd: string, input: Record<string, unknown>): void {
  const value = input.path ?? input.file_path;
  if (typeof value !== 'string') {
    return;
  }
  const root = canonical(cwd);
  const target = canonical(resolve(cwd, value));
  const suffix = relative(root, target);
  const name = basename(target).toLowerCase();
  const normalized = target.replaceAll('\\', '/').toLowerCase();
  if (
    isAbsolute(suffix) ||
    suffix === '..' ||
    suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    name === '.ssh' ||
    name === '.env' ||
    (name.startsWith('.env.') && name !== '.env.example') ||
    normalized.includes('/.ssh/')
  ) {
    throw new PermissionGrantError(
      'SCHEDULE_PERMISSION_DENIED',
      'File access crosses the authorized workspace boundary.'
    );
  }
}
