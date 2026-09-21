/**
 * @author root
 * @description Owns bounded staging, durable content-addressed publication, Range reads, and safe deletion below one application data root.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, open, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export interface PublishedBlob {
  sha256: string;
  storageKey: string;
  byteSize: number;
}

export interface BlobRead {
  stream: Readable;
  byteSize: number;
  start: number;
  end: number;
}

/**
 * Restricts every file operation to managed relative keys below a fixed root.
 */
export class LocalFileBlobStore {
  readonly #root: string;

  /**
   * Creates the managed layout without accepting user-controlled paths.
   *
   * @param root Absolute or process-relative application attachment data root.
   */
  public constructor(root: string) {
    this.#root = resolve(root);
  }

  /**
   * Derives the canonical content-addressed key without touching the filesystem.
   */
  public static storageKeyForSha256(sha256: string): string {
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error('ATTACHMENT_STORAGE_INVALID_KEY');
    }
    return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
  }

  /**
   * Creates the managed directories required by upload, publication, derivatives, and rejection cleanup.
   */
  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.#path('staging'), { recursive: true }),
      mkdir(this.#path('blobs/sha256'), { recursive: true }),
      mkdir(this.#path('derivatives'), { recursive: true }),
      mkdir(this.#path('rejected'), { recursive: true }),
    ]);
  }

  /**
   * Allocates an empty staging file and returns only its managed logical key.
   */
  public async createStaging(): Promise<string> {
    const key = `staging/${randomUUID()}.part`;
    const handle = await open(this.#path(key), 'wx', 0o600);
    await handle.close();
    return key;
  }

  /**
   * Appends one request stream at the exact expected offset and returns the resulting offset.
   *
   * @param key Server-generated staging key.
   * @param source Bounded request stream.
   * @param offset Expected current byte offset.
   * @returns New durable staging size.
   */
  public async append(key: string, source: Readable, offset: number): Promise<number> {
    const path = this.#path(key);
    const current = await stat(path);
    if (!current.isFile() || current.size !== offset) {
      throw new Error('Staging offset conflict.');
    }
    await pipeline(source, createWriteStream(path, { flags: 'r+', start: offset, autoClose: true }));
    const handle = await open(path, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return (await stat(path)).size;
  }

  /**
   * Streams a staging file to compute trusted size and SHA-256 without buffering it in memory.
   */
  public async inspect(key: string): Promise<{ byteSize: number; sha256: string }> {
    const hash = createHash('sha256');
    let byteSize = 0;
    for await (const chunk of createReadStream(this.#path(key))) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteSize += bytes.byteLength;
      hash.update(bytes);
    }
    return { byteSize, sha256: hash.digest('hex') };
  }

  /**
   * Atomically publishes a fully fsynced staging file to its content-addressed location.
   */
  public async publish(
    stagingKey: string,
    expected: { byteSize: number; sha256: string }
  ): Promise<PublishedBlob> {
    const source = this.#path(stagingKey);
    const storageKey = LocalFileBlobStore.storageKeyForSha256(expected.sha256);
    const target = this.#path(storageKey);
    await mkdir(resolve(target, '..'), { recursive: true });
    try {
      const existing = await stat(target);
      if (!existing.isFile() || existing.size !== expected.byteSize) {
        throw new Error('Published blob conflicts with expected bytes.');
      }
      await rm(source, { force: true });
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      await rename(source, target);
      const directory = await open(resolve(target, '..'), 'r');
      try {
        try {
          await directory.sync();
        } catch (error) {
          if (!isUnsupportedDirectorySync(error)) {
            throw error;
          }
        }
      } finally {
        await directory.close();
      }
    }
    return { sha256: expected.sha256, storageKey, byteSize: expected.byteSize };
  }

  /**
   * Opens an immutable blob or derivative using an inclusive optional single byte range.
   */
  public async openRead(storageKey: string, range?: { start: number; end: number }): Promise<BlobRead> {
    const path = this.#path(storageKey);
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error('Blob is unavailable.');
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, info.size - 1);
    if (start < 0 || end < start || end >= info.size) {
      throw new RangeError('Requested byte range is invalid.');
    }
    return { stream: createReadStream(path, { start, end }), byteSize: info.size, start, end };
  }

  /**
   * Removes a managed file after rejecting directories and symbolic links.
   */
  public async delete(storageKey: string): Promise<void> {
    const path = this.#path(storageKey);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error('Managed blob target is invalid.');
      }
      await rm(path, { force: false });
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  /**
   * Checks whether a managed key currently resolves to a regular non-symbolic file.
   */
  public async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.#path(storageKey));
      const info = await lstat(this.#path(storageKey));
      return info.isFile() && !info.isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * Resolves a managed key for a supervised child process without exposing it to external adapters.
   */
  public resolveForProcessor(storageKey: string): string {
    return this.#path(storageKey);
  }

  /**
   * Reads filesystem capacity for disk-watermark admission without exposing its path.
   */
  public async capacity(): Promise<{ totalBytes: number; availableBytes: number; usedRatio: number }> {
    const value = await statfs(this.#root);
    const totalBytes = Number(value.blocks) * Number(value.bsize);
    const availableBytes = Number(value.bavail) * Number(value.bsize);
    return {
      totalBytes,
      availableBytes,
      usedRatio: totalBytes === 0 ? 1 : (totalBytes - availableBytes) / totalBytes,
    };
  }

  /**
   * Inventories regular managed files below a fixed Server-owned prefix for reconciliation.
   */
  public async listManagedFiles(prefix: 'blobs/sha256' | 'staging'): Promise<
    Array<{
      storageKey: string;
      modifiedAtMs: number;
    }>
  > {
    const root = this.#path(prefix);
    const result: Array<{ storageKey: string; modifiedAtMs: number }> = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          await visit(path);
        } else if (entry.isFile() && !entry.isSymbolicLink()) {
          const info = await stat(path);
          result.push({
            storageKey: relative(this.#root, path).split(sep).join('/'),
            modifiedAtMs: info.mtimeMs,
          });
        }
      }
    };
    await visit(root);
    return result;
  }

  /**
   * Resolves a server-generated logical key while preventing absolute paths and traversal.
   */
  #path(key: string): string {
    if (key.length === 0 || isAbsolute(key) || key.includes('\0')) {
      throw new Error('Managed storage key is invalid.');
    }
    const target = resolve(this.#root, ...key.replaceAll('\\', '/').split('/'));
    const child = relative(this.#root, target);
    if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error('Managed storage key escapes the data root.');
    }
    return target;
  }
}

/**
 * Narrows filesystem missing-path errors without leaking their details.
 */
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Accepts only the Windows directory-fsync limitation after the file itself was synced.
 */
function isUnsupportedDirectorySync(error: unknown): boolean {
  return (
    process.platform === 'win32' &&
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EINVAL')
  );
}
