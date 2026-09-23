/**
 * @author root
 * @description Orchestrates durable uploads, admission, processor jobs, derivatives, content reads, prompt reservations, and recovery.
 */
import { NormalizedChunkV1Schema } from '@octopus/shared/protocol/attachments';
import { randomUUID } from 'node:crypto';

import { readFile, rm } from 'node:fs/promises';

import {
  createAttachmentCapabilityResolver,
  DEFAULT_ATTACHMENT_POLICY,
} from '../../infrastructure/attachment-capability/index.js';
import { LocalFileBlobStore } from '../../infrastructure/attachment-storage/local-file-blob-store.js';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';

import { collectAttachmentEvidence } from './attachments.utils.js';

import type { AttachmentBackupService } from '../../infrastructure/attachment-storage/attachment-backup-service.js';
import type { AttachmentJobsRepository } from './attachments.repository.js';
import type { AttachmentsRepository } from './attachments.repository.js';
import type { ProcessorSupervisor } from './workers/processor-supervisor.js';
import type {
  AttachmentResourceDto,
  MessageAttachmentDto,
  ProcessorLimitsV1,
} from '@octopus/shared/protocol/attachments';
import type { FastifyBaseLogger } from 'fastify';

import type { AttachmentJob } from './attachments.repository.js';

const PROCESSOR_LIMITS: ProcessorLimitsV1 = {
  wallTimeMs: 120_000,
  maxRssBytes: 1024 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxOutputFiles: 1_000,
  maxImagePixels: 40_000_000,
  maxPages: 500,
  maxExtractedCharacters: 2_000_000,
};

export interface AttachmentsServiceOptions {
  maxBytes?: number;
  dataRoot?: string;
  repository?: AttachmentsRepository;
  blobStore?: LocalFileBlobStore;
  jobsRepository?: AttachmentJobsRepository;
  supervisor?: ProcessorSupervisor;
  backupRoot?: string;
  /**
   * Publishes committed attachment progress without exposing worker infrastructure.
   */
  onChanged?(): void;
}

/**
 * Owns the Host attachment lifecycle while delegating bytes, decisions, and child execution to lower ports.
 */
export class AttachmentsService {
  readonly #repository: AttachmentsRepository;
  readonly #blobs: LocalFileBlobStore;
  readonly #jobs: AttachmentJobsRepository;
  readonly #supervisor: ProcessorSupervisor;
  readonly #backups: AttachmentBackupService;
  readonly #owner = randomUUID();
  readonly #ready: Promise<void>;
  #activeJobs = 0;
  #closed = false;
  #storagePressure = false;
  #timer?: NodeJS.Timeout;
  readonly #onChanged: () => void;
  #backupTimer?: NodeJS.Timeout;
  #lifecycleTimer?: NodeJS.Timeout;
  #ephemeralRoot?: string;
  #gate: Promise<void> = Promise.resolve();
  public readonly maxBytes: number;
  /**
   * Uses resources owned and assembled by the module entrypoint.
   */
  public constructor(private readonly resources: AttachmentsResources) {
    this.#onChanged = () => {
      try {
        resources.onChanged?.();
      } catch {
        /* Committed work cannot be rolled back by observers. */
      }
    };
    this.maxBytes = resources.maxBytes;
    this.#ephemeralRoot = resources.ephemeralRoot;
    this.#repository = resources.repository;
    this.#blobs = resources.blobs;
    this.#jobs = resources.jobs;
    this.#supervisor = resources.supervisor;
    this.#backups = resources.backups;
    this.#ready = this.#initialize();
  }
  /**
   * Exposes the immutable source metadata needed by attachment delivery.
   */
  getDeliveryRecord(id: string): ReturnType<AttachmentsRepository['getRecord']> {
    return this.#repository.getRecord(id);
  }
  /**
   * Looks up one published derivative for a delivery operation.
   */
  getDeliveryDerivative(...args: Parameters<AttachmentsRepository['getDerivative']>) {
    return this.#repository.getDerivative(...args);
  }
  /**
   * Searches only the admitted attachment list using the existing bounded query.
   */
  searchDeliveryChunks(...args: Parameters<AttachmentsRepository['searchChunks']>) {
    return this.#repository.searchChunks(...args);
  }
  /**
   * Records a completed Agent delivery under the attachment aggregate.
   */
  auditAgentDelivery(...args: Parameters<AttachmentsRepository['auditAgentDelivery']>) {
    return this.#repository.auditAgentDelivery(...args);
  }

  /**
   * Initializes storage, resumes leased work, and starts the bounded local job pump.
   */
  async #initialize(): Promise<void> {
    await this.#blobs.initialize();
    await this.#recoverUploads();
    await this.#reconcilePublishedBlobs();
    await this.#cleanupExpiredUploads();
    await this.#runLifecycle();
    if (this.#closed) {
      return;
    }
    this.#lifecycleTimer = setInterval(
      () => void this.#withBackupGate(() => this.#runLifecycle()),
      60 * 60_000
    );
    this.#lifecycleTimer.unref();
    this.#backupTimer = setInterval(() => void this.#runScheduledBackup(), 24 * 60 * 60_000);
    this.#backupTimer.unref();
    setTimeout(() => void this.#runScheduledBackup(), 5_000).unref();
    this.#drainJobs();
  }

  /**
   * Waits until managed storage and crash-recovery workers are ready.
   */
  public ready(): Promise<void> {
    return this.#ready;
  }
  /**
   * Stops accepting new job claims during Fastify shutdown.
   */
  public async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
    }
    if (this.#backupTimer !== undefined) {
      clearInterval(this.#backupTimer);
    }
    if (this.#lifecycleTimer !== undefined) {
      clearInterval(this.#lifecycleTimer);
    }
    await this.#ready.catch(() => undefined);
    if (this.#ephemeralRoot !== undefined) {
      await rm(this.#ephemeralRoot, { recursive: true, force: true });
    }
  }
  /**
   * Returns the repository used by the tus datastore adapter.
   */
  public get repository(): AttachmentsRepository {
    return this.#repository;
  }
  /**
   * Returns the managed BlobStore used by the tus datastore adapter.
   */
  public get blobStore(): LocalFileBlobStore {
    return this.#blobs;
  }

  /**
   * Applies declared-length, concurrency, queue, and hysteretic disk admission limits.
   */
  public async assertUploadCapacity(
    workspaceId: string,
    ownerId: string,
    uploadLength: number
  ): Promise<void> {
    if (!Number.isSafeInteger(uploadLength) || uploadLength <= 0 || uploadLength > this.maxBytes) {
      throw new ApplicationError(
        'ATTACHMENT_SIZE_LIMIT_EXCEEDED',
        'Upload length exceeds the attachment limit.',
        { statusCode: 413 }
      );
    }
    const counts = this.#repository.getAdmissionCounts(workspaceId, ownerId);
    if (counts.ownerUploads >= 3 || counts.workspaceUploads >= 10 || counts.workspacePendingJobs >= 100) {
      throw new ApplicationError(
        'ATTACHMENT_QUOTA_EXCEEDED',
        'Attachment concurrency or queue capacity is exhausted.',
        { statusCode: 429, retryable: true }
      );
    }
    const capacity = await this.#blobs.capacity();
    if (this.#storagePressure) {
      this.#storagePressure = capacity.usedRatio >= 0.85 || capacity.availableBytes <= 3 * 1024 ** 3;
    } else {
      this.#storagePressure =
        capacity.usedRatio >= 0.9 || capacity.availableBytes - uploadLength < 2 * 1024 ** 3;
    }
    if (this.#storagePressure) {
      throw new ApplicationError('ATTACHMENT_STORAGE_PRESSURE', 'Attachment storage is under pressure.', {
        statusCode: 507,
        retryable: true,
      });
    }
    if (capacity.usedRatio >= 0.8 || capacity.availableBytes - uploadLength < 5 * 1024 ** 3) {
      this.resources.log.warn(
        { usedRatio: capacity.usedRatio },
        'Attachment storage warning watermark reached'
      );
    }
  }

  /**
   * Finalizes a completed tus upload idempotently and schedules admitted processing.
   */
  public async finalize(attachmentId: string): Promise<void> {
    await this.#ready;
    await this.#withBackupGate(() => this.#finalizeUpload(attachmentId));
  }

  /**
   * Runs the replay-safe finalize protocol without awaiting service initialization.
   */
  async #finalizeUpload(attachmentId: string): Promise<void> {
    const upload = this.#repository.getUpload(attachmentId);
    if (upload === undefined) {
      throw new ApplicationError('ATTACHMENT_NOT_FOUND', 'Upload was not found.', { statusCode: 404 });
    }
    const existing = this.#repository.getRecord(attachmentId);
    if (existing?.blob_sha256 !== null && existing?.blob_sha256 !== undefined) {
      if (existing.status === 'verifying') {
        await this.#admitPublished(attachmentId, existing.blob_sha256);
      }
      return;
    }
    const inspected = await this.#blobs.inspect(upload.stagingKey);
    if (inspected.byteSize !== upload.uploadLength) {
      throw new ApplicationError(
        'ATTACHMENT_SIZE_LIMIT_EXCEEDED',
        'Uploaded bytes do not match the declared length.',
        { statusCode: 413 }
      );
    }
    const storageKey = LocalFileBlobStore.storageKeyForSha256(inspected.sha256);
    this.#repository.preparePublish(attachmentId, {
      sha256: inspected.sha256,
      storageKey,
      byteSize: inspected.byteSize,
    });
    const published = await this.#blobs.publish(upload.stagingKey, inspected);
    this.#repository.publish(attachmentId, published);
    await this.#admitPublished(attachmentId, inspected.sha256);
  }

  /**
   * Applies immutable admission evidence and creates the persisted processor plan.
   */
  async #admitPublished(attachmentId: string, sha256: string): Promise<void> {
    const row = this.#repository.getRecord(attachmentId);
    if (row === undefined) {
      return;
    }
    const storageKey = LocalFileBlobStore.storageKeyForSha256(sha256);
    const evidence = await collectAttachmentEvidence(
      {
        name: row.original_name,
        ...(row.declared_mime === null ? {} : { declaredMediaType: row.declared_mime }),
        byteSize: row.byte_size,
        sha256,
        storageKey,
      },
      this.#blobs
    );
    const resolution = createAttachmentCapabilityResolver().resolve(evidence, {
      processors: new Set([
        'image-optimize',
        'pdf-text-extract',
        'office-text-extract',
        'archive-text-extract',
        'spreadsheet-structure-extract',
        'full-text-index',
      ]),
      retrieval: new Set(['structured-file-read', 'lexical-search']),
      tools: new Set(['read-file']),
      policy: { ...DEFAULT_ATTACHMENT_POLICY, maxAttachmentBytes: this.maxBytes },
    });
    const current = this.#repository.require(row.workspace_id, attachmentId);
    if (resolution.decision === 'reject') {
      this.#repository.transition(attachmentId, current.revision, ['verifying'], {
        status: 'rejected',
        resolution,
        detectedMime: evidence.detectedMediaType,
        evidenceJson: JSON.stringify(evidence),
        failure: { code: resolution.diagnostics[0]?.code ?? 'ATTACHMENT_TYPE_UNSUPPORTED', retryable: false },
      });
      this.#repository.detachRejectedBlob(attachmentId, sha256);
      await this.#deleteBlobIfUnreferenced(sha256);
      return;
    }
    const processing = this.#repository.transition(attachmentId, current.revision, ['verifying'], {
      status: 'processing',
      resolution,
      detectedMime: evidence.detectedMediaType,
      evidenceJson: JSON.stringify(evidence),
    });
    this.#jobs.enqueue(attachmentId, {
      sourceKey: storageKey,
      sha256,
      detectedMediaType: evidence.detectedMediaType,
      presentationKind: presentationKind(evidence.detectedMediaType),
      revision: processing.revision,
    });
    void this.#drainJobs();
  }

  /**
   * Replays upload publications interrupted around the atomic Blob rename.
   */
  async #recoverUploads(): Promise<void> {
    for (const operation of this.#repository.listRecoverableUploads()) {
      const upload = this.#repository.getUpload(operation.attachmentId);
      if (upload === undefined || upload.uploadOffset !== upload.uploadLength) {
        continue;
      }
      try {
        if (
          operation.phase === 'publishing' &&
          operation.targetStorageKey !== undefined &&
          operation.expectedSha256 !== undefined &&
          (await this.#blobs.exists(operation.targetStorageKey))
        ) {
          const inspected = await this.#blobs.inspect(operation.targetStorageKey);
          if (
            inspected.byteSize !== operation.expectedSize ||
            inspected.sha256 !== operation.expectedSha256
          ) {
            throw new ApplicationError(
              'ATTACHMENT_FORMAT_EVIDENCE_MISMATCH',
              'Published attachment integrity validation failed.',
              { statusCode: 422 }
            );
          }
          this.#repository.publish(operation.attachmentId, {
            ...inspected,
            storageKey: operation.targetStorageKey,
          });
          await this.#admitPublished(operation.attachmentId, inspected.sha256);
        } else {
          await this.#finalizeUpload(operation.attachmentId);
        }
      } catch (error) {
        this.resources.log.error(
          { attachmentId: operation.attachmentId, code: safeErrorCode(error) },
          'Attachment upload recovery failed'
        );
      }
    }
  }

  /**
   * Marks catalogued resources unavailable when durable bytes are missing at startup.
   */
  async #reconcilePublishedBlobs(): Promise<void> {
    const catalogued = this.#repository.listBlobs();
    for (const blob of catalogued) {
      if (!(await this.#blobs.exists(blob.storageKey))) {
        this.#repository.markBlobUnavailable(blob.sha256);
        this.resources.log.error(
          { sha256: blob.sha256 },
          'Attachment Blob is missing during startup reconciliation'
        );
      }
    }
    const knownBlobs = new Set(catalogued.map((blob) => blob.storageKey));
    const knownStaging = new Set(this.#repository.listActiveStagingKeys());
    const now = Date.now();
    let removed = 0;
    for (const file of await this.#blobs.listManagedFiles('blobs/sha256')) {
      if (!knownBlobs.has(file.storageKey) && file.modifiedAtMs <= now - 60 * 60_000) {
        await this.#blobs.delete(file.storageKey);
        removed += 1;
      }
    }
    for (const file of await this.#blobs.listManagedFiles('staging')) {
      if (!knownStaging.has(file.storageKey) && file.modifiedAtMs <= now - 24 * 60 * 60_000) {
        await this.#blobs.delete(file.storageKey);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.resources.log.info({ removed }, 'Attachment orphan reconciliation removed managed files');
    }
  }

  /**
   * Removes expired tus sessions and their private staging bytes.
   */
  async #cleanupExpiredUploads(): Promise<void> {
    const now = new Date().toISOString();
    for (const id of this.#repository.listExpiredUploadIds(now)) {
      const stagingKey = this.#repository.terminateUpload(id);
      if (stagingKey !== undefined) {
        await this.#blobs.delete(stagingKey);
      }
    }
    this.#repository.purgeExpiredFinalizedUploads(now);
  }

  /**
   * Reconciles pending deletes, expires unbound resources, and prunes terminal audit rows.
   */
  async #runLifecycle(): Promise<void> {
    if (this.#closed) {
      return;
    }
    await this.#cleanupExpiredUploads();
    for (const id of this.#repository.listPendingCleanupIds()) {
      this.#jobs.enqueueCleanup(id);
    }
    const now = new Date().toISOString();
    for (const candidate of this.#repository.listRetentionCandidates(now, 100)) {
      this.#repository.deleteResource(candidate.workspaceId, candidate.id, candidate.revision, randomUUID());
      this.#jobs.cancelForAttachment(candidate.id);
      this.#jobs.enqueueCleanup(candidate.id);
    }
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    this.#repository.pruneTerminalRecords(cutoff);
    void this.#drainJobs();
  }

  /**
   * Reads one Workspace-authorized projection.
   */
  public get(workspaceId: string, id: string): AttachmentResourceDto {
    return this.#repository.require(workspaceId, id);
  }
  /**
   * Rejects a tus item route unless the unfinished upload belongs to the routed Workspace.
   *
   * @param workspaceId Workspace identity carried by the route.
   * @param uploadId Opaque tus upload identity.
   */
  public assertUploadWorkspace(workspaceId: string, uploadId: string): void {
    this.#repository.require(workspaceId, uploadId);
    if (this.#repository.getUpload(uploadId) === undefined) {
      throw new ApplicationError('ATTACHMENT_NOT_FOUND', 'Upload was not found.', { statusCode: 404 });
    }
  }
  /**
   * Reads an ordered, non-enumerating batch projection.
   */
  public list(workspaceId: string, ids: readonly string[]): AttachmentResourceDto[] {
    if (ids.length > 10) {
      throw new ApplicationError('ATTACHMENT_REQUEST_INVALID', 'At most ten attachment IDs are allowed.', {
        statusCode: 400,
      });
    }
    return this.#repository.list(workspaceId, [...new Set(ids)]);
  }

  /**
   * Opens a ready original using one optional inclusive byte range.
   */
  public async openContent(workspaceId: string, id: string, range?: { start: number; end: number }) {
    const dto = this.#repository.require(workspaceId, id);
    const row = this.#repository.getRecord(id);
    if (dto.status !== 'ready' || row?.blob_sha256 === null || row?.blob_sha256 === undefined) {
      throw new ApplicationError('ATTACHMENT_NOT_READY', 'Attachment content is not ready.', {
        statusCode: 423,
        retryable: true,
      });
    }
    const blob = this.#repository.findPublishedBlob(row.blob_sha256) as { storage_key: string } | undefined;
    if (blob === undefined) {
      throw new ApplicationError('ATTACHMENT_NOT_FOUND', 'Attachment content is unavailable.', {
        statusCode: 404,
      });
    }
    return { dto, read: await this.#blobs.openRead(blob.storage_key, range) };
  }

  /**
   * Describe a ready original to the trusted knowledge handoff adapter; HTTP and model projections never receive this path.
   */
  public describeKnowledgeOriginal(workspaceId: string, id: string) {
    const dto = this.#repository.require(workspaceId, id);
    const row = this.#repository.getRecord(id);
    if (dto.status !== 'ready' || !row?.blob_sha256) {
      throw new ApplicationError('ATTACHMENT_NOT_READY', '附件原文尚未准备好', { statusCode: 423 });
    }
    const blob = this.#repository.findPublishedBlob(row.blob_sha256) as { storage_key: string } | undefined;
    if (!blob) {
      throw new ApplicationError('ATTACHMENT_NOT_FOUND', '附件原文不可用', { statusCode: 404 });
    }
    return {
      path: this.#blobs.resolveForProcessor(blob.storage_key),
      sha256: row.blob_sha256,
      byteSize: dto.byteSize,
      title: dto.name,
    };
  }

  /**
   * Opens the bounded image preview derivative selected by the Host.
   */
  public async openPreview(workspaceId: string, id: string) {
    const dto = this.#repository.require(workspaceId, id);
    if (!dto.capabilities.canPreview) {
      throw new ApplicationError('ATTACHMENT_NOT_READY', 'Attachment preview is not available.', {
        statusCode: 423,
        retryable: true,
      });
    }
    const derivative = this.#repository.getDerivative(id, 'preview-image');
    if (derivative === undefined) {
      throw new ApplicationError('ATTACHMENT_NOT_FOUND', 'Attachment preview is unavailable.', {
        statusCode: 404,
      });
    }
    return { dto, derivative, read: await this.#blobs.openRead(derivative.storageKey) };
  }

  /**
   * Reserves attachments for a prompt before Pi preflight.
   */
  public reservePrompt(
    workspaceId: string,
    sessionId: string,
    requestId: string,
    ids: readonly string[]
  ): AttachmentResourceDto[] {
    return this.#repository.reservePrompt(workspaceId, sessionId, requestId, ids);
  }
  /**
   * Releases a reservation when Pi rejects the command.
   */
  public releasePrompt(requestId: string): void {
    this.#repository.releasePrompt(requestId);
  }
  /**
   * Commits a reservation to one durable Pi user entry.
   */
  public bindPrompt(sessionId: string, entryId: string, requestId: string): void {
    this.#repository.bindPrompt(sessionId, entryId, requestId);
  }
  /**
   * Replays ACK-before-crash reservations by locating the persisted Host request marker in Pi entries.
   */
  public reconcilePromptReservations(sessionId: string, entries: readonly unknown[]): void {
    const pending = new Set(this.#repository.listPendingReservations(sessionId));
    if (pending.size === 0) {
      return;
    }
    for (const candidate of entries) {
      if (typeof candidate !== 'object' || candidate === null) {
        continue;
      }
      const entry = candidate as Record<string, unknown>;
      if (
        entry['type'] !== 'message' ||
        typeof entry['id'] !== 'string' ||
        typeof entry['message'] !== 'object' ||
        entry['message'] === null
      ) {
        continue;
      }
      const message = entry['message'] as Record<string, unknown>;
      if (message['role'] !== 'user') {
        continue;
      }
      const text = messageText(message['content']);
      for (const requestId of pending) {
        if (text.includes(`<host_attachment_request id="${requestId}" />`)) {
          this.#repository.bindPrompt(sessionId, entry['id'], requestId);
          pending.delete(requestId);
        }
      }
    }
  }
  /**
   * Batch-loads Conversation projections grouped by Pi entry.
   */
  public listMessageAttachments(sessionId: string): Map<string, MessageAttachmentDto[]> {
    return this.#repository.listMessageAttachments(sessionId);
  }
  /**
   * Deletes one resource with revision CAS and asynchronously removes unreferenced original bytes.
   */
  public async delete(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    idempotencyKey: string
  ): Promise<AttachmentResourceDto> {
    return this.#withBackupGate(() => {
      const dto = this.#repository.deleteResource(workspaceId, id, expectedRevision, idempotencyKey);
      this.#jobs.cancelForAttachment(id);
      this.#jobs.enqueueCleanup(id);
      void this.#drainJobs();
      return dto;
    });
  }
  /**
   * Retries one transient processor failure without replacing the attachment identity.
   */
  public async retry(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    idempotencyKey: string
  ): Promise<AttachmentResourceDto> {
    const rowBefore = this.#repository.getRecord(id);
    await this.assertUploadCapacity(
      workspaceId,
      rowBefore?.owner_id ?? 'local-host-user',
      rowBefore?.byte_size ?? 1
    );
    const dto = this.#repository.retryResource(workspaceId, id, expectedRevision, idempotencyKey);
    const row = this.#repository.getRecord(id);
    if (row?.sha256 === null || row?.sha256 === undefined || row.detected_mime === null) {
      throw new ApplicationError('ATTACHMENT_PROCESSING_FAILED', 'Attachment retry source is unavailable.', {
        statusCode: 422,
      });
    }
    const sourceKey = LocalFileBlobStore.storageKeyForSha256(row.sha256);
    this.#jobs.enqueue(id, {
      sourceKey,
      sha256: row.sha256,
      detectedMediaType: row.detected_mime,
      presentationKind: presentationKind(row.detected_mime),
      revision: dto.revision,
    });
    void this.#drainJobs();
    return dto;
  }

  /**
   * Claims available leases until the configured process-wide concurrency is full.
   */
  #drainJobs(): void {
    clearTimeout(this.#timer);
    if (this.#closed) {
      return;
    }
    while (this.#activeJobs < 2) {
      const job = this.#jobs.claim(this.#owner);
      if (job === undefined) {
        const deadline = this.#jobs.nextWake(this.#owner);
        if (deadline !== undefined) {
          this.#timer = setTimeout(() => this.#drainJobs(), Math.max(0, deadline - Date.now()));
          this.#timer.unref();
        }
        return;
      }
      this.#activeJobs += 1;
      void this.#runJob(job).finally(() => {
        this.#activeJobs -= 1;
        void this.#drainJobs();
      });
    }
  }

  /**
   * Executes one leased child task, publishes verified outputs, and maps stable failures.
   */
  async #runJob(job: AttachmentJob): Promise<void> {
    const heartbeat = setInterval(() => this.#jobs.heartbeat(job.id, this.#owner), 10_000);
    try {
      if (job.jobType === 'cleanup') {
        await this.#runCleanupJob(job);
        return;
      }
      const result = await this.#supervisor.run({
        jobId: job.id,
        attachmentId: job.attachmentId,
        sourceKey: String(job.input['sourceKey']),
        sha256: String(job.input['sha256']),
        detectedMediaType: String(job.input['detectedMediaType']),
        limits: PROCESSOR_LIMITS,
      });
      const dto = await this.#withBackupGate(async () => {
        const current = this.#repository.getRecord(job.attachmentId);
        if (current?.status !== 'processing') {
          await Promise.all([...result.outputKeys.values()].map((key) => this.#blobs.delete(key)));
          return undefined;
        }
        const chunks = await readChunks(result.outputKeys, this.#blobs);
        const published = new Map<string, { storageKey: string; sha256: string; byteSize: number }>();
        for (const output of result.manifest.outputs) {
          const key = result.outputKeys.get(output.localId);
          if (key === undefined) {
            throw new Error('Processor output key is missing.');
          }
          published.set(
            output.localId,
            await this.#blobs.publish(key, { byteSize: output.byteSize, sha256: output.sha256 })
          );
        }
        return this.#repository.completeProcessing({
          attachmentId: job.attachmentId,
          manifest: result.manifest,
          published,
          chunks,
          presentationKind: String(
            job.input['presentationKind']
          ) as AttachmentResourceDto['presentationKind'],
        });
      });
      this.#jobs.succeed(
        job.id,
        this.#owner,
        dto === undefined ? { skipped: 'attachment-not-processing' } : { revision: dto.revision }
      );
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'PROCESSOR_CRASHED';
      const retryable =
        typeof error === 'object' && error !== null && 'retryable' in error ? Boolean(error.retryable) : true;
      this.resources.log.warn(
        { err: error, attachmentId: job.attachmentId, jobId: job.id, code, attempt: job.attempts },
        'Attachment job attempt failed'
      );
      this.#jobs.fail(job, this.#owner, code, retryable);
      if (!retryable || job.attempts >= job.maxAttempts) {
        const record = this.#repository.getRecord(job.attachmentId);
        if (record?.status === 'processing') {
          const rejected =
            code === 'PROCESSOR_RESOURCE_LIMIT_EXCEEDED' || code === 'PROCESSOR_CONTENT_REJECTED';
          this.#repository.transition(job.attachmentId, record.revision, ['processing'], {
            status: rejected ? 'rejected' : 'failed',
            failure: { code, retryable: !rejected && retryable },
          });
          if (rejected && record.sha256 !== null) {
            this.#repository.detachRejectedBlob(job.attachmentId, record.sha256);
            await this.#deleteBlobIfUnreferenced(record.sha256);
          }
        }
      }
    } finally {
      clearInterval(heartbeat);
      this.#onChanged();
    }
  }

  /**
   * Removes detached original and derivative bytes under a leased durable cleanup job.
   */
  async #runCleanupJob(job: AttachmentJob): Promise<void> {
    await this.#withBackupGate(async () => {
      if (this.#repository.isLegallyHeld(job.attachmentId)) {
        this.#repository.deferCleanupForLegalHold(job.attachmentId);
        this.#jobs.succeed(job.id, this.#owner, { held: true });
        return;
      }
      const keys = this.#repository.preparePhysicalCleanup(job.attachmentId);
      for (const key of keys) {
        if (key.startsWith('blobs/sha256/')) {
          const sha256 = key.slice(key.lastIndexOf('/') + 1);
          await this.#deleteBlobIfUnreferenced(sha256);
        } else {
          await this.#blobs.delete(key);
        }
      }
      this.#repository.completePhysicalCleanup(job.attachmentId);
      this.#jobs.succeed(job.id, this.#owner, { removed: keys.length });
    });
  }

  /**
   * Applies an administrative legal hold and resumes cleanup after release.
   */
  public setLegalHold(id: string, reason: string | undefined): void {
    if (this.#repository.setLegalHold(id, reason)) {
      this.#jobs.resumeCleanup(id);
      void this.#drainJobs();
    }
  }

  /**
   * Creates a verified local backup while finalize, delete, and publication share one freeze point.
   */
  public async createBackup(): Promise<void> {
    const prepared = await this.#withBackupGate(() => this.#backups.prepare());
    await this.#backups.copyAndVerify(prepared);
  }

  /**
   * Independently validates a local backup before an administrator uses it for restore.
   */
  public async verifyBackup(id: string): Promise<void> {
    await this.#backups.verifyBackup(id);
  }

  /**
   * Runs the daily backup only when no verified run already covers the RPO window.
   */
  async #runScheduledBackup(): Promise<void> {
    if (this.#closed || this.#backups.hasRecentVerifiedBackup(24 * 60 * 60_000)) {
      return;
    }
    try {
      await this.createBackup();
      this.resources.log.info('Attachment local backup verified');
    } catch (error) {
      this.resources.log.error({ code: safeErrorCode(error) }, 'Attachment local backup failed');
    }
  }

  /**
   * Serializes operations that must share the backup publication freeze point.
   */
  async #withBackupGate<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.#gate;
    let release!: () => void;
    this.#gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /**
   * Deletes an original Blob only after attachment, derivative, and backup pin references reach zero.
   */
  async #deleteBlobIfUnreferenced(sha256: string): Promise<void> {
    const references = this.#repository.countBlobReferences(sha256) as { count: number };
    if (references.count !== 0) {
      return;
    }
    const storageKey = `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
    await this.#blobs.delete(storageKey);
    this.#repository.removeBlobRecord(sha256);
  }
}

/**
 * Selects the immutable Host presentation family from verified detected MIME.
 */
function presentationKind(mime: string): NonNullable<AttachmentResourceDto['presentationKind']> {
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }
  return 'file';
}
/**
 * Loads and validates bounded JSONL chunks before child outputs are published.
 */
async function readChunks(keys: Map<string, string>, blobs: LocalFileBlobStore) {
  const key = keys.get('chunks.jsonl');
  if (key === undefined) {
    return [];
  }
  const source = await readFile(blobs.resolveForProcessor(key), 'utf8');
  return source
    .split('\n')
    .filter(Boolean)
    .map((line) => NormalizedChunkV1Schema.parse(JSON.parse(line)));
}
/**
 * Extracts only public Pi text content for reservation recovery.
 */
function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        (item as Record<string, unknown>)['type'] === 'text' &&
        typeof (item as Record<string, unknown>)['text'] === 'string'
    )
    .map((item) => item.text)
    .join('\n');
}

/**
 * Projects an internal failure into a stable log-only code without serializing its message.
 */
function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return 'ATTACHMENT_RECOVERY_FAILED';
}

export interface AttachmentsResources {
  log: FastifyBaseLogger;
  repository: AttachmentsRepository;
  blobs: LocalFileBlobStore;
  jobs: AttachmentJobsRepository;
  supervisor: ProcessorSupervisor;
  backups: AttachmentBackupService;
  maxBytes: number;
  ephemeralRoot?: string;
  /**
   * Reports committed attachment changes.
   */
  onChanged?(): void;
}
