/**
 * @author Codex
 * @description Single-writer import orchestration with isolated parsing and atomic visibility publication.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { documents, jobs, versions } from '../db/schema.js';
import { KnowledgeError } from '../definitions/error.js';
import { KnowledgeEmbeddings } from './models/embedding.js';
import { runDocumentWorker } from './document-worker.js';
import { KnowledgeBlobStore } from './blob-store.js';
import { rememberKnowledgeSource } from './import-deduplication.js';
import type { KnowledgeIndex } from '../definitions/port.js';
import type { ImportSource, IndexedChunk } from '../definitions/types.js';
import type { JobRecord } from './job-repository.js';
import type { KnowledgeJobRepository } from './job-repository.js';
import type { KnowledgeModelSettings } from './model-settings.js';

const formats = new Set(['docx', 'xlsx', 'pptx', 'csv', 'md', 'txt', 'pdf']);

export class KnowledgeIndexingRunner {
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  private wakeRequested = false;
  private activeJob: string | null = null;

  /**
   * Maintenance may acquire the application gate only when no worker owns native writes.
   */
  get idle(): boolean {
    return this.running === null;
  }

  /**
   * Compose persistence and model infrastructure only inside the daemon's indexing boundary.
   */
  constructor(
    private readonly repository: KnowledgeJobRepository,
    private readonly index: KnowledgeIndex,
    private readonly models: KnowledgeModelSettings,
    private readonly directory: string
  ) {}

  /**
   * Coalesce wakeups so only one process writes Lance tables at a time.
   */
  wake(): void {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    if (!this.stopped && !this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
        this.repository.onChanged();
        if (this.wakeRequested) {
          this.wakeRequested = false;
          this.wake();
        }
      });
    }
  }

  /**
   * Persist cancellation first; abort only the matching active attempt's owned worker.
   */
  cancel(id: string): void {
    this.repository.cancel(id);
    if (this.activeJob === id) {
      this.controller?.abort();
    }
  }

  /**
   * Stop admission and wait for native writes to finish before their database owner closes.
   */
  async close(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
    await this.running;
  }

  /**
   * Execute durable jobs serially with at most two automatic retries per original request.
   */
  private async drain(): Promise<void> {
    while (!this.stopped) {
      const job = this.repository.claim();
      if (!job) {
        return;
      }
      this.activeJob = job.id;
      this.repository.onChanged();
      this.controller = new AbortController();
      try {
        await this.execute(job, this.controller.signal);
      } catch (error) {
        const current = this.repository.get(job.id);
        if (current?.attempt === job.attempt && current.state === 'running') {
          if (
            this.stopped ||
            (error instanceof KnowledgeError && error.retryable && job.automaticRetries < 2)
          ) {
            this.repository.database.db
              .update(jobs)
              .set({ state: 'queued', automaticRetries: job.automaticRetries + (this.stopped ? 0 : 1) })
              .where(eq(jobs.id, job.id))
              .run();
          } else {
            this.repository.finish(
              job,
              'failed',
              error instanceof KnowledgeError ? error.code : 'INDEX_FAILED'
            );
          }
        }
      } finally {
        this.activeJob = null;
        this.controller = null;
        this.repository.onChanged();
      }
    }
  }

  /**
   * Rebuild against a gated collection snapshot; ordinary imports retain completed leaf successes.
   */
  private async execute(job: JobRecord, signal: AbortSignal): Promise<void> {
    const generation = this.repository.generation(job);
    const embedding = new KnowledgeEmbeddings(await this.models.resolve(generation.embeddingConfig), signal);
    const ocr = job.ocrSnapshot ? await this.models.resolve(job.ocrSnapshot) : null;
    let sources: ImportSource[];
    if (job.kind === 'reindex') {
      sources = this.repository.database.db
        .select({
          title: documents.title,
          format: documents.format,
          blobSha256: versions.sourceSha256,
          documentId: documents.id,
          archivePath: documents.sourcePath,
        })
        .from(documents)
        .innerJoin(versions, eq(versions.id, documents.activeVersionId))
        .where(
          and(
            eq(documents.collectionId, job.collectionId),
            isNull(documents.deletedAt),
            isNotNull(documents.activeVersionId),
            job.documentIds?.length ? inArray(documents.id, job.documentIds) : undefined
          )
        )
        .all();
      if (job.documentIds?.length && sources.length !== job.documentIds.length) {
        throw new KnowledgeError('DOCUMENT_CHANGED', '选中文档已删除或无法重新索引，请刷新后重试');
      }
    } else if (job.source) {
      if (['zip', 'tar', 'gz', 'tgz'].includes(job.source.format)) {
        if (job.source.documentId) {
          throw new KnowledgeError('INVALID_INPUT', '替换文档不能上传压缩包');
        }
        const expanded = await runDocumentWorker(
          { kind: 'expand', directory: this.directory, source: job.source },
          signal
        );
        if (!('sources' in expanded)) {
          throw new KnowledgeError('PARSER_FAILED', '压缩解析结果无效');
        }
        sources = expanded.sources;
      } else {
        sources = [job.source];
      }
    } else {
      throw new KnowledgeError('INVALID_INPUT', '导入缺少源文件');
    }
    for (const source of sources) {
      signal.throwIfAborted();
      this.repository.assertCurrent(job);
      const key = createHash('sha256')
        .update((source.documentId ?? source.archivePath ?? source.title) + ':' + source.blobSha256)
        .digest('hex');
      const leaf = this.repository.leaf(job, key, source.archivePath ?? source.title);
      if (leaf.status === 'succeeded' || leaf.status === 'skipped') {
        continue;
      }
      if (!formats.has(source.format)) {
        this.repository.updateLeaf(job, leaf.id, { status: 'skipped', reason: 'UNSUPPORTED_FORMAT' });
        continue;
      }
      try {
        if (job.kind === 'import') {
          await rememberKnowledgeSource(
            this.repository.database,
            new KnowledgeBlobStore(this.directory),
            source.blobSha256
          );
        }
        const document =
          job.kind === 'reindex'
            ? {
                documentId: source.documentId!,
                versionId: this.repository.database.db
                  .select()
                  .from(documents)
                  .where(eq(documents.id, source.documentId!))
                  .get()!.activeVersionId!,
              }
            : this.repository.prepareDocument(job, leaf, source);
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 120,
          separators: ['\n\n', '\n', '。', '！', '？', '；', ' ', ''],
        });
        const indexRevision = randomUUID();
        let chunks: IndexedChunk[] = [];
        let ordinal = 0;
        /**
         * Persist bounded unpublished batches; rebuild search metadata only for the final successful batch.
         */
        const flush = async (final: boolean): Promise<void> => {
          if (!chunks.length) {
            return;
          }
          signal.throwIfAborted();
          const vectors = await embedding.embedDocuments(chunks.map((chunk) => chunk.text));
          this.repository.assertCurrent(job);
          await this.index.write(generation.id, chunks, vectors, final);
          chunks = [];
        };
        await runDocumentWorker(
          { kind: 'parse', directory: this.directory, source, ocr },
          signal,
          async (section) => {
            for (const text of await splitter.splitText(section.text)) {
              if (!text.trim()) {
                continue;
              }
              if (ordinal >= 20_000) {
                throw new KnowledgeError('DOCUMENT_LIMIT', '文档分块数量超过限制');
              }
              if (chunks.length === 64) {
                await flush(false);
              }
              chunks.push({
                ...document,
                documentVersionId: document.versionId,
                collectionId: job.collectionId,
                indexRevision,
                chunkId: createHash('sha256')
                  .update(indexRevision + ':' + ordinal)
                  .digest('hex'),
                text,
                locator: {
                  ...section.locator,
                  ...(source.archivePath ? { archivePath: source.archivePath } : {}),
                },
                ordinal: ordinal++,
                extractionMethod: section.extractionMethod,
              });
            }
          }
        );
        if (!ordinal) {
          throw new KnowledgeError('DOCUMENT_LIMIT', '文档为空');
        }
        await flush(true);
        this.repository.publish(
          job,
          leaf.id,
          generation.id,
          document.documentId,
          document.versionId,
          indexRevision,
          ordinal
        );
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof KnowledgeError && (error.retryable || error.code === 'JOB_CANCELLED'))
        ) {
          throw error;
        }
        this.repository.updateLeaf(job, leaf.id, {
          status: 'failed',
          reason: error instanceof KnowledgeError ? error.code : 'DOCUMENT_FAILED',
        });
      }
    }
    const leaves = this.repository.leaves(job.id);
    const failed = leaves.some((leaf) => leaf.status === 'failed');
    const succeeded = leaves.some((leaf) => leaf.status === 'succeeded');
    this.repository.finish(
      job,
      failed
        ? succeeded && (job.kind !== 'reindex' || !!job.documentIds?.length)
          ? 'partial'
          : 'failed'
        : 'succeeded',
      failed ? 'DOCUMENT_FAILED' : null
    );
  }
}
