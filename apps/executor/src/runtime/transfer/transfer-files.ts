/**
 * @author Codex
 * @description Owns private same-volume binary transfer material and native no-clobber publication.
 */
import { open, lstat, unlink, rmdir, statfs } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { TRANSFER_FILE_LIMIT } from './transfer-inputs';
import { defaultTransferSettings, transferSettingsSchema } from '../../contracts/transfer-settings';
import type { TransferSettings } from '../../contracts/transfer-settings';
import { BasicToolError } from '../basic/basic-inputs';
import { resolveMutationFile, resolveReadableFile } from '../basic/file-policy';
import type { NativeFileCommit } from '../basic/native-file-commit';

export class TransferFiles {
  private readonly limits: TransferSettings;
  /**
   * Keeps native handle enforcement in the executor inside the Runtime.
   */
  constructor(
    readonly native: NativeFileCommit,
    readonly root: string,
    settings: TransferSettings = defaultTransferSettings
  ) {
    this.limits = Object.freeze(transferSettingsSchema.parse(settings));
  }

  /**
   * Rejects relative, linked, oversized and already-existing upload targets before allocation.
   */
  async resolve(path: string, direction: 'upload' | 'download') {
    if (!isAbsolute(path)) {
      throw new BasicToolError('PATH_REJECTED', 'An absolute file path is required.');
    }
    const resolved =
      direction === 'upload'
        ? await resolveMutationFile(path, dirname(path))
        : await resolveReadableFile(path, dirname(path));
    if (direction === 'upload') {
      try {
        await lstat(resolved);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { path: resolved, size: 0 };
        }
        throw error;
      }
      throw new BasicToolError('TARGET_EXISTS', 'Transfer destinations must not exist.');
    }
    const info = await this.native.inspect(resolved);
    if (!info.ok || info.directory || info.links !== 1 || info.size > TRANSFER_FILE_LIMIT) {
      throw new BasicToolError(
        'UNSUPPORTED_FILE',
        'Source must be an ordinary single-link file within 2 GiB.'
      );
    }
    return { path: resolved, size: info.size };
  }

  /**
   * Reserves physical space on the actual target volume, independently of logical quota.
   */
  async capacity(directory: string, size: number): Promise<void> {
    const disk = await statfs(directory, { bigint: true });
    if (disk.bavail * disk.bsize < BigInt(size + this.limits.minimumFreeSpaceMiB * 1024 ** 2)) {
      throw new BasicToolError('DISK_FULL', 'Insufficient space for transfer material and reserve.');
    }
  }

  /**
   * Derives material paths from validated identities; callers never supply staging paths.
   */
  location(id: string, path: string, direction: 'upload' | 'download'): string {
    return join(
      direction === 'upload' ? dirname(path) : this.root,
      `.octopus-executor-recovery-transfer-${id}`
    );
  }

  /**
   * Creates an exclusively owned SID-private directory and an empty upload part when needed.
   */
  async prepare(directory: string, upload: boolean): Promise<string> {
    const result = await this.native.createRecovery(directory);
    if (!result.ok || !result.privateAcl) {
      throw new BasicToolError('STAGING_FAILED', 'Private material directory could not be created.');
    }
    if (upload) {
      const handle = await open(join(directory, 'content'), 'wx', 0o600);
      await handle.close();
    }
    return result.identity;
  }

  /**
   * Checks private staging identity before opening a file for bounded stream access.
   */
  async inspect(directory: string, directoryIdentity?: string, materialIdentity?: string): Promise<void> {
    const info = await this.native.inspect(directory);
    if (
      !info.ok ||
      !info.directory ||
      !info.privateAcl ||
      (directoryIdentity && info.identity !== directoryIdentity)
    ) {
      throw new BasicToolError('STAGING_CHANGED', 'Private transfer material is unavailable.');
    }
    const file = await this.native.inspect(join(directory, 'content'));
    if (
      !file.ok ||
      file.directory ||
      file.links !== 1 ||
      (materialIdentity && file.identity !== materialIdentity)
    ) {
      throw new BasicToolError('STAGING_CHANGED', 'Transfer material identity is invalid.');
    }
  }

  /**
   * Publishes through the existing native create-only operation; never uses overwriting rename.
   */
  async publish(directory: string, path: string, directoryIdentity?: string, materialIdentity?: string) {
    await this.inspect(directory, directoryIdentity, materialIdentity);
    const parent = await this.native.inspect(dirname(path));
    const part = await this.native.inspect(join(directory, 'content'));
    if (!parent.ok || !part.ok) {
      throw new BasicToolError('STAGING_CHANGED', 'Publication identities are unavailable.');
    }
    return this.native.commit({
      target: path,
      temp: join(directory, 'content'),
      backup: join(directory, 'unused-backup'),
      targetIdentity: 'absent',
      parentIdentity: parent.identity,
      tempIdentity: part.identity,
    });
  }

  /**
   * Deletes only the known content file and an empty owned directory, preserving unexpected entries.
   */
  async cleanup(directory: string, identity?: string, materialIdentity?: string): Promise<void> {
    const info = await this.native.inspect(directory);
    if (!info.ok && [2, 3].includes(info.nativeCode)) {
      return;
    }
    if (!identity || !info.ok || !info.directory || !info.privateAcl || info.identity !== identity) {
      throw new Error('Unsafe cleanup directory');
    }
    const path = join(directory, 'content');
    const file = await this.native.inspect(path);
    if (file.ok) {
      if (file.directory || file.links !== 1 || (materialIdentity && file.identity !== materialIdentity)) {
        throw new Error('Unsafe cleanup file');
      }
      await unlink(path);
    } else if (![2, 3].includes(file.nativeCode)) {
      throw new Error('Cannot inspect cleanup file');
    }
    await rmdir(directory);
  }
}
