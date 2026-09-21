/**
 * @author Codex
 * @description Serializes runtime extraction and installation, with guarded recovery of a provably dead installer.
 */
import { open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { gatewayError, isProcessAlive } from '../gateway/index.js';

/**
 * Keeps the lock outside the runtime so extraction and the first installation share one ownership boundary.
 */
export function installLockPath(root: string): string {
  return `${root}.install.lock`;
}

/**
 * Acquires exclusively; ambiguous ownership fails closed, and one recovery gate prevents stale-reader races.
 */
export async function acquireInstallLock(root: string): Promise<() => Promise<void>> {
  const path = installLockPath(root);
  const token = randomUUID();
  /**
   * Reads only a valid owner; an interrupted record write requires explicit inspection.
   */
  async function owner() {
    const value = JSON.parse(await readFile(path, 'utf8')) as { pid: number; token: string };
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.token !== 'string') {
      throw new Error('Invalid installer identity');
    }
    return value;
  }
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    try {
      const recovery = await open(`${path}.recovery`, 'wx', 0o600);
      try {
        const current = await owner();
        if (isProcessAlive(current.pid)) {
          throw new Error('Installer is still running', { cause: error });
        }
        await unlink(path);
        handle = await open(path, 'wx', 0o600);
      } finally {
        await recovery.close();
        await unlink(`${path}.recovery`);
      }
    } catch (cause) {
      throw gatewayError('INSTALL_IN_PROGRESS', `Cannot acquire ${path}. ${String(cause)}`);
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
  } finally {
    await handle.close();
  }
  return async () => {
    const current = await owner();
    if (current.token === token) {
      await unlink(path);
    }
  };
}
