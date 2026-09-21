/**
 * @author Codex
 * @description Independent knowledge source ownership using immutable hash-addressed files.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';

export class KnowledgeBlobStore {
  /**
   * Verify a content-addressed source incrementally and return its private read-only parser path.
   */
  async verifiedPath(sha256: string): Promise<string> {
    await this.fingerprint(sha256);
    return join(this.directory, 'blobs', sha256);
  }

  /**
   * Compute MD5 from owned bytes while verifying SHA-256 integrity with bounded memory.
   */
  async fingerprint(sha256: string): Promise<{ sha256: string; md5: string; size: number }> {
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new KnowledgeError('INVALID_INPUT', '原文标识无效');
    }
    const path = join(this.directory, 'blobs', sha256);
    if ((await stat(path)).size > 100 * 1024 * 1024) {
      throw new KnowledgeError('INVALID_INPUT', '原文超过 100 MiB');
    }
    const hash = createHash('sha256');
    const md5 = createHash('md5');
    let size = 0;
    for await (const chunk of createReadStream(path)) {
      size += (chunk as Buffer).length;
      if (size > 100 * 1024 * 1024) {
        throw new KnowledgeError('INVALID_INPUT', '原文超过 100 MiB');
      }
      hash.update(chunk as Buffer);
      md5.update(chunk as Buffer);
    }
    if (hash.digest('hex') !== sha256) {
      throw new KnowledgeError('SOURCE_CORRUPT', '知识原文校验失败');
    }
    return { sha256, md5: md5.digest('hex'), size };
  }

  /**
   * Import one owned archive member with bounded streaming writes and immutable hash-addressed publication.
   */
  async putFile(path: string, temporaryDirectory?: string): Promise<{ sha256: string; size: number }> {
    await mkdir(join(this.directory, 'blobs'), { recursive: true, mode: 0o700 });
    const temporary = join(temporaryDirectory ?? join(this.directory, 'blobs'), randomUUID() + '.pending');
    const file = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    try {
      try {
        for await (const chunk of createReadStream(path)) {
          const bytes = chunk as Buffer;
          size += bytes.length;
          if (size > 100 * 1024 * 1024) {
            throw new KnowledgeError('INVALID_INPUT', '原文超过 100 MiB');
          }
          hash.update(bytes);
          await file.writeFile(bytes);
        }
        await file.sync();
      } finally {
        await file.close();
      }
      const sha256 = hash.digest('hex');
      await rename(temporary, join(this.directory, 'blobs', sha256));
      return { sha256, size };
    } finally {
      await rm(temporary, { force: true });
    }
  }
  /**
   * The service owns this root; callers cannot pass paths through read APIs.
   */
  constructor(private readonly directory: string) {}

  /**
   * Copy and fsync accepted source bytes before acknowledging an import.
   */
  async put(bytes: Uint8Array): Promise<{ sha256: string; size: number }> {
    if (!bytes.length || bytes.length > 100 * 1024 * 1024) {
      throw new KnowledgeError('INVALID_INPUT', '原文为空或超过 100 MiB');
    }
    await mkdir(join(this.directory, 'blobs'), { recursive: true, mode: 0o700 });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const target = join(this.directory, 'blobs', sha256);
    try {
      if (
        (await stat(target)).size === bytes.length &&
        createHash('sha256')
          .update(await readFile(target))
          .digest('hex') === sha256
      ) {
        return { sha256, size: bytes.length };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const temporary = target + '.' + randomUUID();
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    return { sha256, size: bytes.length };
  }

  /**
   * Read only a valid content hash, verifying immutable source integrity before parsing.
   */
  async read(sha256: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new KnowledgeError('INVALID_INPUT', '原文标识无效');
    }
    const bytes = await readFile(join(this.directory, 'blobs', sha256));
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new KnowledgeError('SOURCE_CORRUPT', '知识原文校验失败');
    }
    return bytes;
  }
}
