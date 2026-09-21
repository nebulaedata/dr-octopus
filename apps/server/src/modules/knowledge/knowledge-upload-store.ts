/**
 * @author Codex
 * @description Knowledge-purpose tus staging over shared filesystem infrastructure and separate nullable-scope SQLite rows.
 */
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { DataStore, Upload } from '@tus/server';
import { eq, lt } from 'drizzle-orm';
import { knowledgeUploads } from '../../db/schema.js';
import { LocalFileBlobStore } from '../../lib/attachment-storage/local-file-blob-store.js';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { Readable } from 'node:stream';
import type { OctopusDatabase } from '../../db/client.js';
import type { KnowledgeService } from './knowledge.service.js';

export class KnowledgeUploadStore extends DataStore {
  override extensions = ['creation', 'termination', 'expiration'];
  private readonly blobs: LocalFileBlobStore;
  private readonly ready: Promise<void>;
  private readonly publishing = new Map<string, Promise<{ sha256: string }>>();

  /**
   * Borrow Server metadata and shared staging utilities without changing ordinary attachment policy.
   */
  constructor(
    private readonly database: OctopusDatabase,
    root: string,
    private readonly service: KnowledgeService
  ) {
    super();
    this.blobs = new LocalFileBlobStore(root);
    this.ready = this.blobs.initialize();
  }

  /**
   * Bind upload identities to their Host-validated scope and one retry-stable creation key.
   */
  override async create(file: Upload): Promise<Upload> {
    await this.ready;
    const metadata = file.metadata!;
    const workspaceId = metadata['workspaceId'] || null;
    const requestKey = createHash('sha256')
      .update(JSON.stringify([workspaceId, metadata['requestId']]))
      .digest('hex');
    const previous = this.database.db
      .select()
      .from(knowledgeUploads)
      .where(eq(knowledgeUploads.requestKey, requestKey))
      .get();
    if (previous) {
      if (previous.filename !== metadata['filename'] || previous.byteSize !== file.size) {
        throw invalid('UPLOAD_CONFLICT', '相同上传标识不能更改文件', 409);
      }
      return this.getUpload(previous.id);
    }
    const capacity = await this.blobs.capacity();
    const pending = this.database.db.select().from(knowledgeUploads).all();
    if (
      pending.length >= 256 ||
      pending.reduce((sum, row) => sum + (row.blobSha256 ? 0 : row.byteSize), 0) + file.size! >
        2 * 1024 ** 3 ||
      capacity.availableBytes < file.size! + 256 * 1024 ** 2
    ) {
      throw invalid('UPLOAD_CAPACITY', '上传暂存空间不足，请稍后重试', 429);
    }
    const stagingKey = await this.blobs.createStaging();
    try {
      this.database.db
        .insert(knowledgeUploads)
        .values({
          id: file.id,
          workspaceId,
          requestKey,
          filename: metadata['filename']!,
          byteSize: file.size!,
          stagingKey,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + this.getExpiration()).toISOString(),
        })
        .onConflictDoNothing({ target: knowledgeUploads.requestKey })
        .run();
    } catch (error) {
      await this.blobs.delete(stagingKey);
      throw error;
    }
    const winner = this.database.db
      .select()
      .from(knowledgeUploads)
      .where(eq(knowledgeUploads.requestKey, requestKey))
      .get()!;
    if (winner.stagingKey !== stagingKey) {
      await this.blobs.delete(stagingKey);
    }
    if (winner.filename !== metadata['filename'] || winner.byteSize !== file.size) {
      throw invalid('UPLOAD_CONFLICT', '相同上传标识不能更改文件', 409);
    }
    return this.getUpload(winner.id);
  }

  /**
   * Enforce scope before raw tus handlers are allowed to access their upload identifier.
   */
  require(id: string, workspaceId?: string) {
    const row = this.database.db.select().from(knowledgeUploads).where(eq(knowledgeUploads.id, id)).get();
    if (!row || row.workspaceId !== (workspaceId ?? null)) {
      throw invalid('UPLOAD_NOT_FOUND', '上传不存在', 404);
    }
    if (Date.parse(row.expiresAt) <= Date.now()) {
      throw invalid('UPLOAD_EXPIRED', '上传已过期，请重新上传', 410);
    }
    return row;
  }

  /**
   * Return the durable SQLite offset after reconnect; the tus lock serializes PATCH requests per id.
   */
  override getUpload(id: string): Promise<Upload> {
    const row = this.database.db.select().from(knowledgeUploads).where(eq(knowledgeUploads.id, id)).get();
    if (!row || Date.parse(row.expiresAt) <= Date.now()) {
      throw invalid('UPLOAD_NOT_FOUND', '上传不存在或已过期', 404);
    }
    return Promise.resolve(
      new Upload({
        id,
        size: row.byteSize,
        offset: row.offset,
        metadata: { filename: row.filename },
        creation_date: row.createdAt,
      })
    );
  }

  /**
   * Bound each streamed chunk and repair any uncommitted tail before resuming at the acknowledged offset.
   */
  override async write(source: Readable, id: string, offset: number): Promise<number> {
    const row = this.database.db.select().from(knowledgeUploads).where(eq(knowledgeUploads.id, id)).get();
    if (!row || row.offset !== offset || row.blobSha256) {
      throw invalid('UPLOAD_OFFSET_CONFLICT', '上传偏移已改变', 409);
    }
    const path = this.blobs.resolveForProcessor(row.stagingKey);
    const truncate = async () => {
      const file = await open(path, 'r+');
      try {
        await file.truncate(offset);
      } finally {
        await file.close();
      }
    };
    await truncate();
    let received = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length;
        done(
          received > Math.min(8 * 1024 ** 2, row.byteSize - offset)
            ? invalid('UPLOAD_SIZE_LIMIT', '上传分片超过限制', 413)
            : null,
          chunk
        );
      },
    });
    const fail = (error: Error) => bounded.destroy(error);
    source.on('error', fail);
    source.pipe(bounded);
    try {
      const next = await this.blobs.append(row.stagingKey, bounded, offset);
      this.database.db
        .update(knowledgeUploads)
        .set({ offset: next })
        .where(eq(knowledgeUploads.id, id))
        .run();
      return next;
    } catch (error) {
      await truncate();
      throw error;
    } finally {
      source.unpipe(bounded);
      source.off('error', fail);
    }
  }

  /**
   * Copy a complete original to daemon-owned storage once; status recovery can safely repeat a lost finish response.
   */
  finalize(id: string, workspaceId?: string): Promise<{ sha256: string }> {
    const row = this.require(id, workspaceId);
    if (row.blobSha256) {
      return Promise.resolve({ sha256: row.blobSha256 });
    }
    if (row.offset !== row.byteSize) {
      throw invalid('UPLOAD_INCOMPLETE', '文件尚未上传完成', 409);
    }
    const existing = this.publishing.get(id);
    if (existing) {
      return existing;
    }
    const pending = (async () => {
      const bytes = await readFile(this.blobs.resolveForProcessor(row.stagingKey));
      if (bytes.length !== row.byteSize) {
        throw invalid('UPLOAD_CORRUPT', '暂存文件长度错误', 409);
      }
      const blob = await this.service.upload(workspaceId, bytes);
      this.database.db
        .update(knowledgeUploads)
        .set({ blobSha256: blob.sha256 })
        .where(eq(knowledgeUploads.id, id))
        .run();
      await this.blobs.delete(row.stagingKey);
      return { sha256: blob.sha256 };
    })().finally(() => this.publishing.delete(id));
    this.publishing.set(id, pending);
    return pending;
  }

  /**
   * Remove staged bytes after all in-flight publication has settled; imported documents have independent ownership.
   */
  override async remove(id: string): Promise<void> {
    await this.publishing.get(id)?.catch(() => undefined);
    const row = this.database.db.select().from(knowledgeUploads).where(eq(knowledgeUploads.id, id)).get();
    if (!row) {
      return;
    }
    await this.blobs.delete(row.stagingKey);
    this.database.db.delete(knowledgeUploads).where(eq(knowledgeUploads.id, id)).run();
  }

  /**
   * Bound staging retention; the same path handles unfinished and already copied uploads.
   */
  override async deleteExpired(): Promise<number> {
    await this.ready;
    const rows = this.database.db
      .select()
      .from(knowledgeUploads)
      .where(lt(knowledgeUploads.expiresAt, new Date().toISOString()))
      .limit(100)
      .all();
    for (const row of rows) {
      await this.remove(row.id);
    }
    return rows.length;
  }

  /**
   * Drain accepted transfers before Server closes its metadata database.
   */
  async close(): Promise<void> {
    await Promise.allSettled(this.publishing.values());
  }

  /**
   * Fixed one-day upload lifetime is separate from seven-day evidence retention.
   */
  override getExpiration(): number {
    return 86_400_000;
  }
}

/**
 * Translate upload faults into the existing safe Server error shape.
 */
function invalid(code: string, message: string, statusCode: number): ApplicationError {
  return new ApplicationError(code, message, { statusCode });
}
