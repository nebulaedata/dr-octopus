/**
 * @author root
 * @description Publishes verified attachment artifacts into a permanent content-addressed Workspace cache.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  ensureManagedDirectories,
  prepareWorkspaceAttachmentCacheRoot,
} from './workspace-attachment-cache-root.js';
import type { LocalFileBlobStore } from '../../lib/attachment-storage/local-file-blob-store.js';

export type WorkspaceAttachmentCacheResult =
  { status: 'ready'; path: string } | { status: 'unavailable'; reason: string };

export interface WorkspaceAttachmentCacheInput {
  workspaceCwd: string;
  storageKey: string;
  artifactSha256: string;
  kind: 'original' | 'document-json';
  filename: string;
}

/**
 * Owns safe creation, validation, and repair of permanent Workspace attachment cache entries.
 */
export class WorkspaceAttachmentCache {
  /**
   * @param blobs Immutable Server artifact authority used to reconstruct cache entries.
   */
  public constructor(private readonly blobs: LocalFileBlobStore) {}

  /**
   * Publishes or reuses one verified content-addressed artifact below the fixed Workspace cache.
   *
   * @param input Trusted artifact identity and Workspace selected by the Host Session.
   * @returns A ready Workspace path or a stable reason that the cache is unavailable.
   */
  public async materialize(input: WorkspaceAttachmentCacheInput): Promise<WorkspaceAttachmentCacheResult> {
    try {
      assertSha256(input.artifactSha256);
      const root = await prepareWorkspaceAttachmentCacheRoot(input.workspaceCwd);
      const filename =
        input.kind === 'document-json' ? 'document.json' : `original${safeExtension(input.filename)}`;
      const target = join(
        root,
        'sha256',
        input.artifactSha256.slice(0, 2),
        input.artifactSha256.slice(2, 4),
        input.artifactSha256,
        input.kind,
        filename
      );
      await ensureManagedDirectories(root, dirname(target));
      const existing = await inspectRegularFile(target);
      if (existing !== undefined && existing.sha256 === input.artifactSha256 && existing.byteSize > 0) {
        return { status: 'ready', path: target };
      }
      await this.#publish(input.storageKey, target, input.artifactSha256);
      return { status: 'ready', path: target };
    } catch (error) {
      return { status: 'unavailable', reason: cacheFailureReason(error) };
    }
  }

  /**
   * Streams one authoritative artifact through a verified temporary file before atomic publication.
   *
   * @param storageKey Server BlobStore key for the selected artifact.
   * @param target Final content-addressed Workspace path.
   * @param expectedSha256 Expected artifact checksum from Server metadata.
   */
  async #publish(storageKey: string, target: string, expectedSha256: string): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await pipeline(
        (await this.blobs.openRead(storageKey)).stream,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
      );
      const inspected = await inspectRegularFile(temporary);
      if (inspected === undefined || inspected.sha256 !== expectedSha256) {
        throw new Error('Workspace attachment cache publication checksum did not match.');
      }
      const current = await lstatIfExists(target);
      if (current?.isSymbolicLink() === true || (current !== undefined && !current.isFile())) {
        throw new Error('Workspace attachment cache target is not a regular file.');
      }
      if (current !== undefined) {
        await rm(target, { force: true });
      }
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

/**
 * Inspects a regular file with a streaming checksum and rejects links or special files.
 *
 * @param path Candidate cache file.
 * @returns File checksum and size, or undefined when the path does not exist.
 */
async function inspectRegularFile(path: string): Promise<{ sha256: string; byteSize: number } | undefined> {
  const metadata = await lstatIfExists(path);
  if (metadata === undefined) {
    return undefined;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Workspace attachment cache entry is not a regular file.');
  }
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    byteSize += chunk.length;
  }
  return { sha256: hash.digest('hex'), byteSize };
}

/**
 * Reads link-aware metadata without treating a missing path as an infrastructure failure.
 *
 * @param path Candidate filesystem path.
 * @returns Link-aware metadata or undefined for ENOENT.
 */
async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Validates a lowercase hexadecimal SHA-256 identity before using it in a path.
 *
 * @param value Candidate digest.
 */
function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Workspace attachment cache requires a valid SHA-256 identity.');
  }
}

/**
 * Produces a bounded normalized extension while keeping cache identity independent of display names.
 *
 * @param value Original display filename.
 * @returns Safe lowercase extension including the leading dot.
 */
function safeExtension(value: string): string {
  const extension = extname(basename(value)).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/u.test(extension) ? extension : '.bin';
}

/**
 * Extracts a concise stable cache failure reason without leaking infrastructure details into prompts.
 *
 * @param error Unknown cache preparation failure.
 * @returns Stable diagnostic text.
 */
function cacheFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Workspace attachment cache is unavailable.';
}

/**
 * Checks an unknown Node error for one stable code.
 *
 * @param error Unknown thrown value.
 * @param code Expected Node error code.
 * @returns Whether the error exposes the expected code.
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
