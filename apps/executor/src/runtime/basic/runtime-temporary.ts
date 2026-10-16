/**
 * @author Codex
 * @description Owns one private system-temporary directory for disposable Runtime search snapshots.
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmdir } from 'node:fs/promises';
import type { NativeFileCommit } from './native-file-commit';

/**
 * Creates an unpredictable directory with private ACL from its first instant, never adopting another instance.
 */
export async function createRuntimeTemporary(native: NativeFileCommit) {
  const root = join(tmpdir(), `octopus-executor-${randomUUID()}`);
  const created = await native.createRecovery(root);
  if (!created.ok || !created.privateAcl) {
    throw new Error('RUNTIME_TEMPORARY_UNAVAILABLE');
  }
  return {
    root,
    /**
     * Removes only the original empty root after owned processes drain; unexpected files remain for inspection.
     */
    async close(): Promise<void> {
      const current = await native.inspect(root);
      if (!current.ok && current.nativeCode === 2) {
        return;
      }
      if (!current.ok || current.identity !== created.identity || !current.privateAcl) {
        throw new Error('RUNTIME_TEMPORARY_CHANGED');
      }
      try {
        await rmdir(root);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY')) {
          throw error;
        }
      }
    },
  };
}
