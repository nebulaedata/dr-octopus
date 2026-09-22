/**
 * @author Codex
 * @description Durable job admission, attempt fencing and atomic index publication.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { collections, documents, entries, generations, importItems, jobs, versions } from '../db/schema.js';
import { KnowledgeError } from '../definitions/error.js';
import { assertKnowledgeSourceAvailable } from './import-deduplication.js';
import type { KnowledgeDatabase } from '../db/database.js';
import type { EmbeddingConfig, OcrConfig } from '../definitions/models.js';
import type { ImportSource, KnowledgeJob } from '../definitions/types.js';

export type JobRecord = typeof jobs.$inferSelect;
export type LeafRecord = typeof importItems.$inferSelect;

export class KnowledgeJobRepository {
  /**
   * Borrow the sole writer's connection; publication never spans an asynchronous transaction.
   */
  constructor(
    readonly database: KnowledgeDatabase,
    readonly onChanged: () => void = () => undefined
  ) {}

  /**
   * Replaying an identical request returns its original job, including after a response was lost.
   */
  enqueue(
    principal: string,
    collectionId: string,
    key: string,
    kind: 'import' | 'reindex',
    source: ImportSource | null,
    embedding: EmbeddingConfig,
    ocr: OcrConfig | null,
    documentIds?: string[]
  ): JobRecord {
    if (!key || key.length > 128) {
      throw new KnowledgeError('INVALID_INPUT', '请求标识无效');
    }
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          collectionId,
          source,
          ...(documentIds ? { documentIds: [...documentIds].sort() } : {}),
        })
      )
      .digest('hex');
    return this.database.sqlite.transaction(() => {
      const old = this.database.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.principal, principal), eq(jobs.kind, kind), eq(jobs.idempotencyKey, key)))
        .get();
      if (old) {
        if (old.payloadHash !== hash) {
          throw new KnowledgeError('IDEMPOTENCY_CONFLICT', '相同请求标识不能提交不同内容');
        }
        return old;
      }
      const parent = this.database.db
        .select()
        .from(collections)
        .where(eq(collections.id, collectionId))
        .get();
      if (!parent || parent.deletedAt) {
        throw new KnowledgeError('NOT_FOUND', '集合已删除');
      }
      if (documentIds !== undefined) {
        if (
          kind !== 'reindex' ||
          !documentIds.length ||
          documentIds.length > 100 ||
          new Set(documentIds).size !== documentIds.length
        ) {
          throw new KnowledgeError('INVALID_INPUT', '请选择 1 到 100 份不同文档');
        }
        for (const documentId of documentIds) {
          const document = this.database.db
            .select()
            .from(documents)
            .where(eq(documents.id, documentId))
            .get();
          if (!document || document.deletedAt || document.collectionId !== collectionId) {
            throw new KnowledgeError('NOT_FOUND', '选中的文档不存在或不属于当前集合');
          }
          if (!document.activeVersionId || !parent.activeGenerationId) {
            throw new KnowledgeError('INVALID_INPUT', '选中文档尚无可重建的索引，请先完成导入或重试导入任务');
          }
        }
      }
      if (kind === 'reindex' && parent.rebuildJobId) {
        throw new KnowledgeError('REINDEX_BUSY', '此集合正在重建索引');
      }
      if (kind === 'import' && source) {
        assertKnowledgeSourceAvailable(this.database, collectionId, source.blobSha256, true);
      }
      const id = randomUUID();
      const row = this.database.db
        .insert(jobs)
        .values({
          id,
          principal,
          collectionId,
          kind,
          source,
          documentIds: documentIds ?? null,
          idempotencyKey: key,
          payloadHash: hash,
          embeddingSnapshot: embedding,
          ocrSnapshot: ocr,
          createdAt: new Date().toISOString(),
        })
        .returning()
        .get();
      if (kind === 'reindex') {
        this.database.db
          .update(collections)
          .set({ rebuildJobId: id })
          .where(eq(collections.id, collectionId))
          .run();
      }
      return row;
    })();
  }

  /**
   * Recover only unfinished attempts while retaining completed leaves and monotonic fencing tokens.
   */
  recover(): void {
    this.database.db
      .update(jobs)
      .set({ state: 'queued', stage: 'recovered', attempt: sql`${jobs.attempt} + 1` })
      .where(eq(jobs.state, 'running'))
      .run();
    this.database.db
      .update(importItems)
      .set({ status: 'queued' })
      .where(eq(importItems.status, 'running'))
      .run();
  }

  /**
   * Claim one job; collection rebuilds hold only their own import gate.
   */
  claim(): JobRecord | null {
    return this.database.sqlite.transaction(() => {
      const candidates = this.database.db
        .select()
        .from(jobs)
        .where(eq(jobs.state, 'queued'))
        .orderBy(asc(jobs.createdAt))
        .all();
      for (const job of candidates) {
        const parent = this.database.db
          .select()
          .from(collections)
          .where(eq(collections.id, job.collectionId))
          .get();
        if (!parent || parent.deletedAt || job.cancelRequested) {
          this.cancel(job.id);
          continue;
        }
        if (job.kind === 'import' && parent.rebuildJobId) {
          continue;
        }
        return this.database.db
          .update(jobs)
          .set({ state: 'running', stage: 'parsing', attempt: job.attempt + 1, error: null })
          .where(eq(jobs.id, job.id))
          .returning()
          .get();
      }
      return null;
    })();
  }

  /**
   * A cancelled, superseded or recovered attempt cannot publish or report success.
   */
  assertCurrent(job: KnowledgeJob): void {
    const current = this.get(job.id);
    if (
      !current ||
      current.attempt !== job.attempt ||
      current.state !== 'running' ||
      current.cancelRequested
    ) {
      throw new KnowledgeError('JOB_CANCELLED', '导入任务已取消或由新执行接管');
    }
  }

  /**
   * Read job state without returning provider credentials to callers.
   */
  get(id: string): JobRecord | null {
    return this.database.db.select().from(jobs).where(eq(jobs.id, id)).get() ?? null;
  }

  /**
   * Explicitly retry a terminal job while preserving successful archive leaves and re-acquiring the rebuild gate.
   */
  retry(id: string, expectedAttempt: number): JobRecord {
    return this.database.sqlite.transaction(() => {
      const job = this.get(id);
      if (
        !job ||
        !['failed', 'partial', 'cancelled'].includes(job.state) ||
        job.attempt !== expectedAttempt
      ) {
        throw new KnowledgeError('REVISION_CONFLICT', '任务状态已改变，请刷新');
      }
      const parent = this.database.db
        .select()
        .from(collections)
        .where(eq(collections.id, job.collectionId))
        .get();
      if (!parent || parent.deletedAt) {
        throw new KnowledgeError('NOT_FOUND', '集合已删除');
      }
      if (job.kind === 'reindex') {
        if (parent.rebuildJobId) {
          throw new KnowledgeError('REINDEX_BUSY', '集合正在重建');
        }
        this.database.db
          .update(collections)
          .set({ rebuildJobId: id })
          .where(eq(collections.id, parent.id))
          .run();
      }
      this.database.db
        .update(importItems)
        .set({ status: 'queued', reason: null })
        .where(
          and(eq(importItems.jobId, id), inArray(importItems.status, ['failed', 'cancelled', 'running']))
        )
        .run();
      return this.database.db
        .update(jobs)
        .set({
          state: 'queued',
          stage: 'queued',
          cancelRequested: false,
          automaticRetries: 0,
          error: null,
          finishedAt: null,
        })
        .where(eq(jobs.id, id))
        .returning()
        .get();
    })();
  }

  /**
   * Return an already accepted request before checking model readiness or reading its original again.
   */
  replay(
    principal: string,
    collectionId: string,
    key: string,
    kind: 'import' | 'reindex',
    source: ImportSource | null,
    documentIds?: string[]
  ): JobRecord | null {
    const previous = this.database.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.principal, principal), eq(jobs.kind, kind), eq(jobs.idempotencyKey, key)))
      .get();
    if (
      previous &&
      previous.payloadHash !==
        createHash('sha256')
          .update(
            JSON.stringify({
              collectionId,
              source,
              ...(documentIds ? { documentIds: [...documentIds].sort() } : {}),
            })
          )
          .digest('hex')
    ) {
      throw new KnowledgeError('IDEMPOTENCY_CONFLICT', '相同请求标识不能提交不同内容');
    }
    return previous ?? null;
  }

  /**
   * Record an archive leaf exactly once even when enumeration or parsing is repeated.
   */
  leaf(job: KnowledgeJob, entryKey: string, path: string): LeafRecord {
    this.assertCurrent(job);
    this.database.db
      .insert(importItems)
      .values({ id: randomUUID(), jobId: job.id, entryKey, archivePath: path, status: 'queued' })
      .onConflictDoNothing()
      .run();
    return this.database.db
      .select()
      .from(importItems)
      .where(and(eq(importItems.jobId, job.id), eq(importItems.entryKey, entryKey)))
      .get()!;
  }

  /**
   * Expose ordered leaf outcomes for import feedback and completed-leaf recovery.
   */
  leaves(id: string): LeafRecord[] {
    return this.database.db
      .select()
      .from(importItems)
      .where(eq(importItems.jobId, id))
      .orderBy(asc(importItems.archivePath))
      .all();
  }

  /**
   * Mutate leaf outcome only while the job attempt still owns its writes.
   */
  updateLeaf(
    job: KnowledgeJob,
    id: string,
    patch: Partial<Pick<LeafRecord, 'documentId' | 'documentVersionId' | 'status' | 'reason'>>
  ): void {
    this.assertCurrent(job);
    this.database.db
      .update(importItems)
      .set({ ...patch, attempt: job.attempt })
      .where(and(eq(importItems.id, id), eq(importItems.jobId, job.id)))
      .run();
    if (patch.status === 'failed') {
      const leaf = this.database.db.select().from(importItems).where(eq(importItems.id, id)).get();
      if (leaf?.documentId && leaf.documentVersionId) {
        this.database.db
          .update(documents)
          .set({ status: 'failed' })
          .where(
            and(
              eq(documents.id, leaf.documentId),
              eq(documents.desiredVersionId, leaf.documentVersionId),
              isNull(documents.deletedAt)
            )
          )
          .run();
      }
    }
    this.onChanged();
  }

  /**
   * Select or create the generation without changing an already active embedding fingerprint.
   */
  generation(job: KnowledgeJob): typeof generations.$inferSelect {
    this.assertCurrent(job);
    const parent = this.database.db
      .select()
      .from(collections)
      .where(eq(collections.id, job.collectionId))
      .get()!;
    if (job.documentIds?.length) {
      if (
        !parent.activeGenerationId ||
        (job.targetGenerationId && job.targetGenerationId !== parent.activeGenerationId)
      ) {
        throw new KnowledgeError('DOCUMENT_CHANGED', '集合索引已变更，请重新提交选中文档的索引任务');
      }
      this.database.db
        .update(jobs)
        .set({ targetGenerationId: parent.activeGenerationId })
        .where(eq(jobs.id, job.id))
        .run();
      job.targetGenerationId = parent.activeGenerationId;
    }
    const id = job.targetGenerationId ?? (job.kind === 'import' ? parent.activeGenerationId : null);
    if (id) {
      return this.database.db.select().from(generations).where(eq(generations.id, id)).get()!;
    }
    if (!job.embeddingSnapshot) {
      throw new KnowledgeError('MODEL_NOT_CONFIGURED', '请配置 Embedding 模型');
    }
    const generation = this.database.db
      .insert(generations)
      .values({
        id: randomUUID(),
        collectionId: job.collectionId,
        embeddingConfig: job.embeddingSnapshot,
        fingerprint: createHash('sha256')
          .update(
            JSON.stringify({
              endpoint: job.embeddingSnapshot.endpoint,
              model: job.embeddingSnapshot.model,
              dimensions: job.embeddingSnapshot.dimensions,
            })
          )
          .digest('hex'),
        state: 'building',
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    this.database.db.update(jobs).set({ targetGenerationId: generation.id }).where(eq(jobs.id, job.id)).run();
    job.targetGenerationId = generation.id;
    return generation;
  }

  /**
   * Create a pending version once, or enforce the caller's expected revision for document replacement.
   */
  prepareDocument(
    job: KnowledgeJob,
    leaf: LeafRecord,
    source: ImportSource
  ): { documentId: string; versionId: string } {
    this.assertCurrent(job);
    return this.database.sqlite.transaction(() => {
      if (leaf.documentId) {
        const previous = this.database.db
          .select()
          .from(documents)
          .where(eq(documents.id, leaf.documentId))
          .get();
        if (
          !previous ||
          previous.deletedAt ||
          !leaf.documentVersionId ||
          previous.desiredVersionId !== leaf.documentVersionId
        ) {
          throw new KnowledgeError('DOCUMENT_CHANGED', '文档已删除或已由新版本替换');
        }
        this.updateLeaf(job, leaf.id, { status: 'running' });
        return { documentId: previous.id, versionId: leaf.documentVersionId };
      }
      const documentId = source.documentId ?? randomUUID();
      assertKnowledgeSourceAvailable(this.database, job.collectionId, source.blobSha256);
      const versionId = randomUUID();
      if (source.documentId) {
        const changed = this.database.db
          .update(documents)
          .set({ desiredVersionId: versionId, status: 'indexing', revision: sql`${documents.revision} + 1` })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.collectionId, job.collectionId),
              eq(documents.revision, source.expectedRevision ?? -1),
              isNull(documents.deletedAt)
            )
          )
          .run();
        if (!changed.changes) {
          throw new KnowledgeError('REVISION_CONFLICT', '文档已变更，请刷新后重试');
        }
      } else {
        this.database.db
          .insert(documents)
          .values({
            id: documentId,
            collectionId: job.collectionId,
            title: source.title,
            format: source.format,
            sourcePath: source.archivePath ?? '',
            desiredVersionId: versionId,
            status: 'indexing',
            createdAt: new Date().toISOString(),
          })
          .run();
      }
      this.database.db
        .insert(versions)
        .values({
          id: versionId,
          documentId,
          sourceSha256: source.blobSha256,
          parserVersion: 'octopus-document/v1',
          createdAt: new Date().toISOString(),
        })
        .run();
      this.updateLeaf(job, leaf.id, { documentId, documentVersionId: versionId, status: 'running' });
      return { documentId, versionId };
    })();
  }

  /**
   * Publish only verified Lance rows and a still-desired version; rebuild entries remain invisible until the final swap.
   */
  publish(
    job: KnowledgeJob,
    leafId: string,
    generationId: string,
    documentId: string,
    versionId: string,
    indexRevision: string,
    chunkCount: number
  ): void {
    this.database.sqlite.transaction(() => {
      this.assertCurrent(job);
      const document = this.database.db.select().from(documents).where(eq(documents.id, documentId)).get();
      const parent = this.database.db
        .select()
        .from(collections)
        .where(eq(collections.id, job.collectionId))
        .get();
      if (
        !parent ||
        parent.deletedAt ||
        !document ||
        document.deletedAt ||
        (job.kind === 'import'
          ? document.desiredVersionId !== versionId
          : document.activeVersionId !== versionId)
      ) {
        throw new KnowledgeError('DOCUMENT_CHANGED', '索引生成期间文档已删除或更新');
      }
      this.database.db
        .insert(entries)
        .values({
          id: randomUUID(),
          generationId,
          documentId,
          documentVersionId: versionId,
          indexRevision,
          chunkCount,
        })
        .onConflictDoUpdate({
          target: [entries.generationId, entries.documentId],
          set: { documentVersionId: versionId, indexRevision, chunkCount },
        })
        .run();
      if (job.kind === 'import') {
        this.database.db
          .update(documents)
          .set({
            activeVersionId: versionId,
            status: 'ready',
            ...(job.source?.documentId === documentId
              ? { title: job.source.title, format: job.source.format }
              : {}),
          })
          .where(eq(documents.id, documentId))
          .run();
        if (!parent.activeGenerationId) {
          this.database.db
            .update(collections)
            .set({ activeGenerationId: generationId })
            .where(eq(collections.id, parent.id))
            .run();
          this.database.db
            .update(generations)
            .set({ state: 'active' })
            .where(eq(generations.id, generationId))
            .run();
        }
      }
      this.updateLeaf(job, leafId, { status: 'succeeded', reason: null });
    })();
  }

  /**
   * Swap a fully built generation atomically, leaving old evidence available for retained citations.
   */
  finish(job: KnowledgeJob, state: 'succeeded' | 'partial' | 'failed', error: string | null = null): void {
    this.database.sqlite.transaction(() => {
      this.assertCurrent(job);
      if (job.kind === 'reindex') {
        const parent = this.database.db
          .select()
          .from(collections)
          .where(eq(collections.id, job.collectionId))
          .get()!;
        if (parent.rebuildJobId !== job.id) {
          throw new KnowledgeError('JOB_CANCELLED', '重建任务已失效');
        }
        if (!job.documentIds?.length && state === 'succeeded' && job.targetGenerationId) {
          if (parent.activeGenerationId) {
            this.database.db
              .update(generations)
              .set({ state: 'retired' })
              .where(eq(generations.id, parent.activeGenerationId))
              .run();
          }
          this.database.db
            .update(generations)
            .set({ state: 'active' })
            .where(eq(generations.id, job.targetGenerationId))
            .run();
          this.database.db
            .update(collections)
            .set({ activeGenerationId: job.targetGenerationId })
            .where(eq(collections.id, parent.id))
            .run();
        } else if (!job.documentIds?.length && job.targetGenerationId) {
          this.database.db
            .update(generations)
            .set({ state: 'failed' })
            .where(eq(generations.id, job.targetGenerationId))
            .run();
        }
        this.database.db
          .update(collections)
          .set({ rebuildJobId: null })
          .where(eq(collections.id, parent.id))
          .run();
      }
      this.database.db
        .update(jobs)
        .set({ state, stage: state, error, finishedAt: new Date().toISOString() })
        .where(eq(jobs.id, job.id))
        .run();
      if (state === 'failed') {
        this.failPending(job.id, error ?? 'INDEX_FAILED');
      }
    })();
  }

  /**
   * Persist cancellation before interrupting workers; late results are fenced by attempt.
   */
  cancel(id: string): void {
    this.database.sqlite.transaction(() => {
      this.database.db
        .update(jobs)
        .set({
          state: 'cancelled',
          stage: 'cancelled',
          cancelRequested: true,
          attempt: sql`${jobs.attempt} + 1`,
          finishedAt: new Date().toISOString(),
        })
        .where(and(eq(jobs.id, id), inArray(jobs.state, ['queued', 'running', 'waiting_dependency'])))
        .run();
      this.database.db
        .update(collections)
        .set({ rebuildJobId: null })
        .where(eq(collections.rebuildJobId, id))
        .run();
      if (this.get(id)?.state === 'cancelled') {
        this.failPending(id, 'JOB_CANCELLED');
      }
    })();
  }

  /**
   * Settle pending document states when an attempt terminates before reaching per-leaf error handling.
   */
  private failPending(id: string, reason: string): void {
    for (const leaf of this.leaves(id).filter((item) => ['queued', 'running'].includes(item.status))) {
      this.database.db
        .update(importItems)
        .set({ status: reason === 'JOB_CANCELLED' ? 'cancelled' : 'failed', reason })
        .where(eq(importItems.id, leaf.id))
        .run();
      if (leaf.documentId && leaf.documentVersionId) {
        this.database.db
          .update(documents)
          .set({ status: 'failed' })
          .where(
            and(
              eq(documents.id, leaf.documentId),
              eq(documents.desiredVersionId, leaf.documentVersionId),
              isNull(documents.deletedAt)
            )
          )
          .run();
      }
    }
  }
}
