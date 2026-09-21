/**
 * @author Codex
 * @description Daemon composition root and transport-independent operation dispatch.
 */
import { join } from 'node:path';
import { openKnowledgeDatabase } from '../db/database.js';
import { KnowledgeError } from '../definitions/error.js';
import { SqliteCatalogRepository } from '../lib/catalog-repository.js';
import { KnowledgeCatalogService, validatePage } from '../services/catalog-service.js';
import { KnowledgeBlobStore } from '../lib/blob-store.js';
import { rememberKnowledgeSource } from '../lib/import-deduplication.js';
import { KnowledgeModelSettings } from '../lib/model-settings.js';
import { executeKnowledgeModel } from '../lib/model-execution.js';
import { LanceKnowledgeIndex } from '../lib/lance-index.js';
import { KnowledgeJobRepository } from '../lib/job-repository.js';
import { KnowledgeIndexingRunner } from '../lib/indexing-runner.js';
import { KnowledgeSearchRepository } from '../lib/search-repository.js';
import { KnowledgeSearchEngine } from '../lib/search-engine.js';
import { KnowledgeSharingStore } from '../lib/mcp/sharing-store.js';
import { KnowledgeMountStore } from '../lib/mcp/mount-store.js';
import { FederatedKnowledgeSearch } from '../lib/mcp/federated-search.js';
import { inspectKnowledgeImportTicket, readKnowledgeImportTicket } from '../sdk/import-ticket.js';
import { maintainKnowledge } from '../lib/maintenance.js';
import type { KnowledgeCommand } from './protocol.js';

/**
 * Open owned resources only after the native singleton lock is held.
 * @param directory Knowledge storage directory resolved by the profile.
 * @param agentDir Canonical Agent configuration directory for MCP connections and attachment tickets.
 */
export async function createKnowledgeApplication(directory: string, agentDir: string) {
  const database = openKnowledgeDatabase(join(directory, 'control.sqlite'));
  let index: LanceKnowledgeIndex;
  try {
    index = await LanceKnowledgeIndex.open(join(directory, 'lance'));
  } catch (error) {
    database.sqlite.close();
    throw error;
  }
  const repository = new SqliteCatalogRepository(database);
  const catalog = new KnowledgeCatalogService(repository);
  const blobs = new KnowledgeBlobStore(directory);
  const models = new KnowledgeModelSettings(database, directory);
  const jobs = new KnowledgeJobRepository(database);
  const runner = new KnowledgeIndexingRunner(jobs, index, models, directory);
  const search = new KnowledgeSearchEngine(new KnowledgeSearchRepository(database, catalog), index, models);
  const sharing = new KnowledgeSharingStore(database);
  const mounts = new KnowledgeMountStore(database, agentDir, sharing.get().instanceId);
  const federated = new FederatedKnowledgeSearch(search, mounts);
  jobs.recover();
  runner.wake();
  let activeCalls = 0;
  let maintenance: Promise<void> | null = null;
  let nextMaintenance = Date.now() + 60_000;
  let closing = false;
  const timer = setInterval(() => {
    if (closing || maintenance) {
      return;
    }
    if (!activeCalls && runner.idle && Date.now() >= nextMaintenance) {
      nextMaintenance = Date.now() + 60_000;
      maintenance = maintainKnowledge(database, index, directory)
        .catch(() => {
          // Cleanup is idempotent and must not terminate query availability; retry on the next idle tick.
        })
        .finally(() => {
          maintenance = null;
        });
    } else {
      runner.wake();
    }
  }, 1000);

  /**
   * A short exclusive maintenance window protects native readers without persisting distributed query leases.
   */
  async function enter(): Promise<void> {
    if (maintenance) {
      await maintenance;
    }
    if (closing) {
      throw new KnowledgeError('UNAVAILABLE', '知识库正在停止');
    }
    activeCalls += 1;
  }

  return {
    blobs,
    models,
    database,
    /**
     * Source publication shares the maintenance gate with operation dispatch.
     */
    async upload(bytes: Uint8Array) {
      await enter();
      try {
        return await blobs.put(bytes);
      } finally {
        activeCalls -= 1;
      }
    },
    /**
     * Centralize authorization before any operation touches catalog, jobs, settings or evidence.
     */
    async call(command: KnowledgeCommand, signal?: AbortSignal): Promise<unknown> {
      await enter();
      try {
        return await dispatch(command, signal);
      } finally {
        activeCalls -= 1;
      }
    },
    /**
     * Drain workers and native writes before closing databases and releasing daemon ownership.
     */
    async close(): Promise<void> {
      closing = true;
      clearInterval(timer);
      await maintenance;
      await runner.close();
      index.close();
      database.sqlite.close();
    },
  };

  /**
   * Keep domain authorization and routing inside the admission and maintenance boundary.
   */
  async function dispatch(command: KnowledgeCommand, signal?: AbortSignal): Promise<unknown> {
    const context = command.context;
    if (
      (command.operation.startsWith('sharing.') || command.operation.startsWith('mounts.')) &&
      !['sharing.authorize', 'sharing.catalog'].includes(command.operation) &&
      !context.globalWrite
    ) {
      throw new KnowledgeError('FORBIDDEN', '此调用未授权管理知识库连接');
    }
    switch (command.operation) {
      case 'models.ocr':
      case 'models.embed':
      case 'models.rerank':
        return executeKnowledgeModel(command, models, blobs, signal);
      case 'jobs.importAttachment': {
        catalog.requireCollection(context, command.input.collectionId, true);
        const ticket = await inspectKnowledgeImportTicket(
          agentDir,
          command.input.attachmentRef,
          context.workspaceId,
          context.agentSessionId
        );
        const format = /\.(tgz|tar\.gz)$/iu.test(ticket.title)
          ? 'tgz'
          : ticket.title.split('.').at(-1)!.toLowerCase();
        const source = { title: ticket.title, format, blobSha256: ticket.sha256 };
        const replay = jobs.replay(
          context.principal,
          command.input.collectionId,
          command.input.requestId,
          'import',
          source
        );
        if (replay) {
          return replay;
        }
        const original = await readKnowledgeImportTicket(
          agentDir,
          command.input.attachmentRef,
          context.workspaceId,
          context.agentSessionId
        );
        const blob = await blobs.put(original.bytes);
        await rememberKnowledgeSource(database, blobs, blob.sha256);
        const config = models.get();
        if (!config.embedding) {
          throw new KnowledgeError('MODEL_NOT_CONFIGURED', '请先配置 Embedding 模型');
        }
        const job = jobs.enqueue(
          context.principal,
          command.input.collectionId,
          command.input.requestId,
          'import',
          { title: original.title, format, blobSha256: blob.sha256 },
          config.embedding,
          config.ocr
        );
        runner.wake();
        return job;
      }
      case 'collections.get':
        return catalog.requireCollection(context, command.input.id);
      case 'sharing.get':
        return sharing.get();
      case 'sharing.save':
        return sharing.save(command.input);
      case 'sharing.authorize':
        return sharing.authorize(command.input.token);
      case 'sharing.catalog':
        return sharing.catalog(command.input.token);
      case 'mounts.connections':
        return mounts.connections();
      case 'mounts.list':
        return mounts.list();
      case 'mounts.create':
        return mounts.create(command.input.connectionRef, signal);
      case 'mounts.refresh':
        return mounts.refresh(command.input.id, signal);
      case 'mounts.delete':
        mounts.remove(command.input.id);
        return { ok: true };
      case 'collections.list':
        if (command.input.scope?.kind !== 'workspace') {
          await mounts.refreshStale(signal);
        }
        return catalog.list(context, command.input.page, command.input.pageSize, command.input.scope);
      case 'collections.create':
        return catalog.create(context, command.input.scope, command.input.name, command.input.description);
      case 'collections.update':
        return catalog.update(context, command.input.id, command.input.revision, command.input.patch);
      case 'collections.delete':
        catalog.remove(context, command.input.id, command.input.revision);
        return { ok: true };
      case 'documents.list':
        if (catalog.requireCollection(context, command.input.collectionId).source === 'remote') {
          throw new KnowledgeError('REMOTE_READ_ONLY', '远程集合不提供本地文档管理');
        }
        validatePage(command.input.page, command.input.pageSize);
        return repository.listDocuments(
          command.input.collectionId,
          command.input.page ?? 1,
          command.input.pageSize ?? 20,
          command.input.query
        );
      case 'documents.update':
      case 'documents.delete': {
        const document = repository.getDocument(command.input.id);
        if (!document) {
          throw new KnowledgeError('NOT_FOUND', '文档不存在');
        }
        catalog.requireCollection(context, document.collectionId, true);
        if (command.operation === 'documents.update') {
          return repository.renameDocument(document.id, command.input.revision, command.input.title);
        }
        repository.deleteDocument(document.id, command.input.revision);
        return { ok: true };
      }
      case 'jobs.import':
      case 'jobs.reindex': {
        catalog.requireCollection(context, command.input.collectionId, true);
        const source = command.operation === 'jobs.import' ? command.input.source : null;
        const documentIds = command.operation === 'jobs.reindex' ? command.input.documentIds : undefined;
        const replay = jobs.replay(
          context.principal,
          command.input.collectionId,
          command.input.requestId,
          command.operation === 'jobs.import' ? 'import' : 'reindex',
          source,
          documentIds
        );
        if (replay) {
          return replay;
        }
        const config = models.get();
        if (!config.embedding) {
          throw new KnowledgeError('MODEL_NOT_CONFIGURED', '请在 Settings - 知识库配置 Embedding 模型');
        }
        if (source) {
          await rememberKnowledgeSource(database, blobs, source.blobSha256);
        }
        const job = jobs.enqueue(
          context.principal,
          command.input.collectionId,
          command.input.requestId,
          command.operation === 'jobs.import' ? 'import' : 'reindex',
          source,
          config.embedding,
          config.ocr,
          documentIds
        );
        runner.wake();
        return job;
      }
      case 'jobs.get':
      case 'jobs.retry':
      case 'jobs.cancel': {
        const job = jobs.get(command.input.id);
        if (!job) {
          throw new KnowledgeError('NOT_FOUND', '任务不存在');
        }
        catalog.requireCollection(context, job.collectionId, command.operation !== 'jobs.get');
        if (command.operation === 'jobs.retry') {
          const result = jobs.retry(job.id, command.input.expectedAttempt);
          runner.wake();
          return result;
        }
        if (command.operation === 'jobs.cancel') {
          runner.cancel(job.id);
          return { ok: true };
        }
        return { job, leaves: jobs.leaves(job.id) };
      }
      case 'search':
        return federated.search(
          context,
          command.input.collectionIds,
          command.input.query,
          command.input.limit,
          signal
        );
      case 'read':
        return command.input.citationId.startsWith('remote_')
          ? mounts.read(command.input.citationId, signal)
          : search.read(context, command.input.citationId);
      case 'settings.get':
      case 'settings.save':
      case 'settings.probe':
        if (context.modelAccess !== 'manage') {
          throw new KnowledgeError('MODEL_MANAGEMENT_DENIED', '当前调用方未获得模型管理权限');
        }
        return command.operation === 'settings.get'
          ? models.get()
          : command.operation === 'settings.probe'
            ? models.probe(command.input.config, signal)
            : models.save(command.input.revision, command.input.config);
    }
  }
}
