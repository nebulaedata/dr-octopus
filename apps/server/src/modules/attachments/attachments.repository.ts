/**
 * @author root
 * @description Persists attachment resources, tus offsets, CAS transitions, idempotency operations, and message bindings in SQLite.
 */

import { createHash, randomUUID } from 'node:crypto';
import { AttachmentResourceSchema, MessageAttachmentSchema } from '@octopus/shared/protocol/attachments';
import { mergeDocumentCoverage, readDocumentCoverage } from './attachment-coverage.js';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { AttachmentCapabilityResolution } from '../../lib/attachment-capability/index.js';
import type {
  ArtifactManifestV1,
  AttachmentResourceDto,
  AttachmentStatus,
  MessageAttachmentDto,
  NormalizedChunkV1,
} from '@octopus/shared/protocol/attachments';
import type { OctopusDatabase } from '../../db/client.js';

interface AttachmentRecord {
  id: string;
  workspace_id: string;
  owner_id: string;
  original_name: string;
  declared_mime: string | null;
  detected_mime: string | null;
  byte_size: number;
  sha256: string | null;
  blob_sha256: string | null;
  status: AttachmentStatus;
  classification: AttachmentResourceDto['classification'] | null;
  presentation_kind: AttachmentResourceDto['presentationKind'] | null;
  failure_code: string | null;
  failure_retryable: number;
  policy_version: string | null;
  rule_version: string | null;
  revision: number;
  evidence_json: string | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  expires_at: string | null;
  deleted_at: string | null;
}

export interface CreateUploadRecord {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  declaredMediaType?: string;
  uploadLength: number;
  stagingKey: string;
  expiresAt: string;
  idempotencyKey: string;
}

export interface TusUploadRecord {
  uploadId: string;
  uploadLength: number;
  uploadOffset: number;
  metadata: Record<string, string | null>;
  stagingKey: string;
  expiresAt: string;
}

export interface RecoverableUploadOperation {
  attachmentId: string;
  phase: 'initiated' | 'publishing';
  stagingKey: string;
  targetStorageKey?: string;
  expectedSize: number;
  expectedSha256?: string;
}

/**
 * Keeps all SQLite mutations behind explicit transactions and conditional writes.
 */
export class AttachmentsRepository {
  readonly #sqlite: OctopusDatabase['sqlite'];

  /**
   *
   * @param database Process-owned SQLite control plane.
   */
  public constructor(database: OctopusDatabase) {
    this.#sqlite = database.sqlite;
  }

  /**
   * Creates an attachment, tus upload, and initiated operation atomically with idempotent replay.
   */
  public createUpload(input: CreateUploadRecord): AttachmentResourceDto {
    const fingerprint = hashJson({
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      name: input.name,
      declaredMediaType: input.declaredMediaType,
      uploadLength: input.uploadLength,
    });
    const existing = this.#operation(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw conflict(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used for another request.',
          false
        );
      }
      return this.require(input.workspaceId, existing.attachment_id ?? input.id);
    }
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      this.#sqlite
        .prepare(
          `INSERT INTO attachments(id,workspace_id,owner_id,original_name,declared_mime,byte_size,status,revision,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?, 'initiated',1,?,?,?)`
        )
        .run(
          input.id,
          input.workspaceId,
          input.ownerId,
          input.name,
          input.declaredMediaType ?? null,
          input.uploadLength,
          now,
          now,
          input.expiresAt
        );
      this.#sqlite
        .prepare(
          `INSERT INTO tus_uploads(upload_id,upload_length,upload_offset,metadata_json,staging_key,expires_at,updated_at) VALUES(?,?,0,?,?,?,?)`
        )
        .run(
          input.id,
          input.uploadLength,
          JSON.stringify({ filename: input.name, declaredMediaType: input.declaredMediaType ?? null }),
          input.stagingKey,
          input.expiresAt,
          now
        );
      this.#sqlite
        .prepare(
          `INSERT INTO attachment_operations(id,idempotency_key,fingerprint,attachment_id,operation,phase,staging_key,expected_size,created_at,updated_at,expires_at) VALUES(?,?,?,?, 'upload-create','initiated',?,?,?,?,?)`
        )
        .run(
          randomUUID(),
          input.idempotencyKey,
          fingerprint,
          input.id,
          input.stagingKey,
          input.uploadLength,
          now,
          now,
          input.expiresAt
        );
    })();
    return this.require(input.workspaceId, input.id);
  }

  /**
   * Reads the tus upload authoritative offset and metadata.
   */
  public getUpload(id: string): TusUploadRecord | undefined {
    const row = this.#sqlite.prepare('SELECT * FROM tus_uploads WHERE upload_id = ?').get(id) as
      Record<string, unknown> | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      uploadId: String(row['upload_id']),
      uploadLength: Number(row['upload_length']),
      uploadOffset: Number(row['upload_offset']),
      metadata: JSON.parse(String(row['metadata_json'])) as Record<string, string | null>,
      stagingKey: String(row['staging_key']),
      expiresAt: String(row['expires_at']),
    };
  }

  /**
   * Distinguishes an expired upload tombstone from a non-enumerating unknown identity.
   */
  public isExpiredUpload(id: string): boolean {
    return (
      this.#sqlite
        .prepare(
          `SELECT 1 FROM attachment_operations
       WHERE attachment_id=? AND operation='upload-create' AND expires_at<=? LIMIT 1`
        )
        .get(id, new Date().toISOString()) !== undefined
    );
  }

  /**
   * Terminates an unfinished upload and records a deleted resource tombstone.
   */
  public terminateUpload(id: string): string | undefined {
    const upload = this.getUpload(id);
    if (upload === undefined) {
      return undefined;
    }
    const record = this.#record(id);
    if (record?.blob_sha256 !== null && record?.blob_sha256 !== undefined) {
      throw conflict(
        'UPLOAD_ALREADY_FINALIZED',
        'A finalized upload must be deleted as an attachment resource.',
        false
      );
    }
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      this.#sqlite.prepare('DELETE FROM tus_uploads WHERE upload_id=?').run(id);
      this.#sqlite
        .prepare(
          `UPDATE attachments SET status='deleted',deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND status!='deleted'`
        )
        .run(now, now, id);
    })();
    return upload.stagingKey;
  }

  /**
   * Lists expired unfinished upload identities for lifecycle cleanup.
   */
  public listExpiredUploadIds(now: string): string[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT u.upload_id FROM tus_uploads u JOIN attachments a ON a.id=u.upload_id WHERE u.expires_at <= ? AND a.blob_sha256 IS NULL`
        )
        .all(now) as Array<{ upload_id: string }>
    ).map((row) => row.upload_id);
  }

  /**
   * Removes expired tus protocol metadata after a finalized resource no longer needs HEAD resume state.
   */
  public purgeExpiredFinalizedUploads(now: string): number {
    return this.#sqlite
      .prepare(
        `DELETE FROM tus_uploads
       WHERE expires_at<=? AND upload_id IN (SELECT id FROM attachments WHERE blob_sha256 IS NOT NULL)`
      )
      .run(now).changes;
  }

  /**
   * Returns upload and queue counts used by pre-create backpressure admission.
   */
  public getAdmissionCounts(
    workspaceId: string,
    ownerId: string
  ): {
    ownerUploads: number;
    workspaceUploads: number;
    workspacePendingJobs: number;
  } {
    const row = this.#sqlite
      .prepare(
        `SELECT
         (SELECT count(*) FROM tus_uploads u JOIN attachments a ON a.id=u.upload_id
          WHERE a.owner_id=? AND a.status IN ('initiated','uploading')) AS owner_uploads,
         (SELECT count(*) FROM tus_uploads u JOIN attachments a ON a.id=u.upload_id
          WHERE a.workspace_id=? AND a.status IN ('initiated','uploading')) AS workspace_uploads,
         (SELECT count(*) FROM attachment_jobs j JOIN attachments a ON a.id=j.attachment_id
          WHERE a.workspace_id=? AND j.status IN ('pending','running')) AS workspace_pending_jobs`
      )
      .get(ownerId, workspaceId, workspaceId) as {
      owner_uploads: number;
      workspace_uploads: number;
      workspace_pending_jobs: number;
    };
    return {
      ownerUploads: row.owner_uploads,
      workspaceUploads: row.workspace_uploads,
      workspacePendingJobs: row.workspace_pending_jobs,
    };
  }

  /**
   * Advances one upload offset only when the caller holds the exact previous value.
   */
  public updateUploadOffset(id: string, expectedOffset: number, nextOffset: number): void {
    const now = new Date().toISOString();
    const result = this.#sqlite
      .prepare(
        `UPDATE tus_uploads SET upload_offset=?,updated_at=? WHERE upload_id=? AND upload_offset=? AND ? <= upload_length`
      )
      .run(nextOffset, now, id, expectedOffset, nextOffset);
    if (result.changes !== 1) {
      throw conflict('UPLOAD_OFFSET_CONFLICT', 'Upload offset does not match the Server offset.', true);
    }
    this.#sqlite
      .prepare(
        `UPDATE attachments SET status='uploading',revision=revision+1,updated_at=? WHERE id=? AND status IN ('initiated','uploading')`
      )
      .run(now, id);
  }

  /**
   * Persists the checksum-addressed publication intent before the filesystem rename.
   */
  public preparePublish(id: string, blob: { sha256: string; storageKey: string; byteSize: number }): void {
    const now = new Date().toISOString();
    const result = this.#sqlite
      .prepare(
        `UPDATE attachment_operations
         SET phase='publishing',target_storage_key=?,expected_sha256=?,expected_size=?,updated_at=?
         WHERE attachment_id=? AND operation='upload-create' AND phase IN ('initiated','publishing')`
      )
      .run(blob.storageKey, blob.sha256, blob.byteSize, now, id);
    if (result.changes !== 1) {
      throw conflict('ATTACHMENT_STATE_CONFLICT', 'Attachment publication journal is unavailable.', true);
    }
  }

  /**
   * Lists publication operations that startup recovery can deterministically replay.
   */
  public listRecoverableUploads(): RecoverableUploadOperation[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT attachment_id,phase,staging_key,target_storage_key,expected_size,expected_sha256
         FROM attachment_operations
         WHERE operation='upload-create' AND phase IN ('initiated','publishing')`
      )
      .all() as Array<{
      attachment_id: string;
      phase: 'initiated' | 'publishing';
      staging_key: string;
      target_storage_key: string | null;
      expected_size: number;
      expected_sha256: string | null;
    }>;
    return rows.map((row) => ({
      attachmentId: row.attachment_id,
      phase: row.phase,
      stagingKey: row.staging_key,
      expectedSize: row.expected_size,
      ...(row.target_storage_key === null ? {} : { targetStorageKey: row.target_storage_key }),
      ...(row.expected_sha256 === null ? {} : { expectedSha256: row.expected_sha256 }),
    }));
  }

  /**
   * Commits a durable content-addressed publication and moves the resource to verifying.
   */
  public publish(id: string, blob: { sha256: string; storageKey: string; byteSize: number }): void {
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      this.#sqlite
        .prepare(
          `INSERT INTO blobs(sha256,storage_key,byte_size,state,created_at) VALUES(?,?,?,'published',?) ON CONFLICT(sha256) DO UPDATE SET state='published'`
        )
        .run(blob.sha256, blob.storageKey, blob.byteSize, now);
      const result = this.#sqlite
        .prepare(
          `UPDATE attachments SET sha256=?,blob_sha256=?,byte_size=?,status='verifying',revision=revision+1,updated_at=? WHERE id=? AND status IN ('initiated','uploading','verifying')`
        )
        .run(blob.sha256, blob.sha256, blob.byteSize, now, id);
      if (result.changes !== 1) {
        throw conflict(
          'ATTACHMENT_STATE_CONFLICT',
          'Attachment cannot be finalized from its current state.',
          true
        );
      }
      this.#sqlite
        .prepare(
          `UPDATE attachment_operations SET phase='committed',target_storage_key=?,expected_sha256=?,result_json=?,updated_at=? WHERE attachment_id=? AND operation='upload-create'`
        )
        .run(blob.storageKey, blob.sha256, JSON.stringify(blob), now, id);
    })();
  }

  /**
   * Removes the original Blob reference after a deny-by-default admission rejection.
   */
  public detachRejectedBlob(id: string, sha256: string): void {
    this.#sqlite
      .prepare(
        `UPDATE attachments
         SET blob_sha256=NULL,updated_at=?
         WHERE id=? AND blob_sha256=? AND status='rejected'`
      )
      .run(new Date().toISOString(), id, sha256);
  }

  /**
   * Returns every catalogued Blob for startup filesystem reconciliation.
   */
  public listBlobs(): Array<{ sha256: string; storageKey: string; byteSize: number }> {
    return this.#sqlite
      .prepare(`SELECT sha256,storage_key,byte_size FROM blobs WHERE state='published'`)
      .all()
      .map((row) => {
        const blob = row as { sha256: string; storage_key: string; byte_size: number };
        return { sha256: blob.sha256, storageKey: blob.storage_key, byteSize: blob.byte_size };
      });
  }

  /**
   * Returns staging keys still owned by authoritative tus sessions.
   */
  public listActiveStagingKeys(): string[] {
    return (
      this.#sqlite.prepare('SELECT staging_key FROM tus_uploads').all() as Array<{
        staging_key: string;
      }>
    ).map((row) => row.staging_key);
  }

  /**
   * Marks resources unavailable without exposing the missing storage path.
   */
  public markBlobUnavailable(sha256: string): void {
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      this.#sqlite.prepare(`UPDATE blobs SET state='deleting' WHERE sha256=?`).run(sha256);
      this.#sqlite
        .prepare(
          `UPDATE attachments
           SET status='failed',failure_code='ATTACHMENT_STORAGE_UNAVAILABLE',failure_retryable=1,
               updated_at=?,revision=revision+1
           WHERE blob_sha256=? AND status NOT IN ('deleted','rejected','failed')`
        )
        .run(now, sha256);
    })();
  }

  /**
   * Applies a revision-fenced state transition and freezes capability evidence or failure metadata.
   */
  public transition(
    id: string,
    expectedRevision: number,
    from: readonly AttachmentStatus[],
    update: {
      status: AttachmentStatus;
      resolution?: AttachmentCapabilityResolution;
      detectedMime?: string;
      presentationKind?: AttachmentResourceDto['presentationKind'];
      evidenceJson?: string;
      failure?: { code: string; retryable: boolean };
    }
  ): AttachmentResourceDto {
    const current = this.#record(id);
    if (current === undefined) {
      throw notFound();
    }
    const now = new Date().toISOString();
    const placeholders = from.map(() => '?').join(',');
    const retention =
      update.status === 'rejected'
        ? new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
        : update.status === 'failed' || update.status === 'ready'
          ? new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
          : null;
    const result = this.#sqlite
      .prepare(
        `UPDATE attachments SET status=?,detected_mime=COALESCE(?,detected_mime),classification=COALESCE(?,classification),presentation_kind=COALESCE(?,presentation_kind),failure_code=?,failure_retryable=?,policy_version=COALESCE(?,policy_version),rule_version=COALESCE(?,rule_version),evidence_json=COALESCE(?,evidence_json),ready_at=CASE WHEN ?='ready' THEN ? ELSE ready_at END,deleted_at=CASE WHEN ?='deleted' THEN ? ELSE deleted_at END,expires_at=COALESCE(?,expires_at),revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status IN (${placeholders})`
      )
      .run(
        update.status,
        update.detectedMime ?? null,
        update.resolution?.category ?? null,
        update.presentationKind ?? null,
        update.failure?.code ?? null,
        update.failure?.retryable ? 1 : 0,
        update.resolution?.policyVersion ?? null,
        update.resolution?.ruleVersion ?? null,
        update.evidenceJson ?? null,
        update.status,
        now,
        update.status,
        now,
        retention,
        now,
        id,
        expectedRevision,
        ...from
      );
    if (result.changes !== 1) {
      throw conflict('ATTACHMENT_STATE_CONFLICT', 'Attachment revision or state changed concurrently.', true);
    }
    return this.require(current.workspace_id, id);
  }

  /**
   * Reads one authorized Workspace projection or returns a non-enumerating not-found error.
   */
  public require(workspaceId: string, id: string): AttachmentResourceDto {
    const record = this.#record(id);
    if (record === undefined || record.workspace_id !== workspaceId) {
      throw notFound();
    }
    return toDto(record);
  }

  /**
   * Reads up to ten authorized attachment projections in caller order.
   */
  public list(workspaceId: string, ids: readonly string[]): AttachmentResourceDto[] {
    return ids.map((id) => this.require(workspaceId, id));
  }

  /**
   * Freezes a ready attachment list for one Pi command using requestId idempotency.
   */
  public reservePrompt(
    workspaceId: string,
    sessionId: string,
    requestId: string,
    ids: readonly string[]
  ): AttachmentResourceDto[] {
    if (ids.length > 10 || new Set(ids).size !== ids.length) {
      throw new ApplicationError('ATTACHMENT_REQUEST_INVALID', 'Attachment list is invalid.', {
        statusCode: 400,
      });
    }
    const fingerprint = hashJson({ workspaceId, sessionId, ids });
    const existing = this.#operation(requestId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw conflict(
          'IDEMPOTENCY_KEY_REUSED',
          'Request identity was reused with different attachments.',
          false
        );
      }
      return this.list(workspaceId, ids);
    }
    const items = this.list(workspaceId, ids);
    if (items.some((item) => item.status !== 'ready')) {
      throw new ApplicationError(
        'ATTACHMENT_NOT_READY',
        'Every attachment must be ready before submission.',
        { statusCode: 423, retryable: true }
      );
    }
    const now = new Date().toISOString();
    this.#sqlite
      .prepare(
        `INSERT INTO attachment_operations(id,idempotency_key,fingerprint,operation,phase,result_json,created_at,updated_at) VALUES(?,?,?,'prompt-reservation','reserved',?,?,?)`
      )
      .run(randomUUID(), requestId, fingerprint, JSON.stringify({ workspaceId, sessionId, ids }), now, now);
    return items;
  }

  /**
   * Releases a reservation rejected before Pi accepted the command.
   */
  public releasePrompt(requestId: string): void {
    this.#sqlite
      .prepare(
        `DELETE FROM attachment_operations WHERE idempotency_key=? AND operation='prompt-reservation' AND phase='reserved'`
      )
      .run(requestId);
  }

  /**
   * Binds a Pi entry to the frozen reservation and commits exactly one ordered projection set.
   */
  public bindPrompt(sessionId: string, entryId: string, requestId: string): void {
    const operation = this.#operation(requestId);
    if (operation === undefined || operation.operation !== 'prompt-reservation') {
      return;
    }
    const frozen = JSON.parse(operation.result_json ?? '{}') as { sessionId?: string; ids?: string[] };
    if (frozen.sessionId !== sessionId || !Array.isArray(frozen.ids)) {
      return;
    }
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      frozen.ids?.forEach((id, ordinal) => {
        const record = this.#record(id);
        if (record === undefined) {
          return;
        }
        const dto = toMessageDto(record);
        this.#sqlite
          .prepare(
            `INSERT OR IGNORE INTO message_attachments(session_id,entry_id,attachment_id,ordinal,request_id,presentation_json,created_at) VALUES(?,?,?,?,?,?,?)`
          )
          .run(sessionId, entryId, id, ordinal, requestId, JSON.stringify(dto), now);
      });
      this.#sqlite
        .prepare(`UPDATE attachment_operations SET phase='committed',updated_at=? WHERE idempotency_key=?`)
        .run(now, requestId);
      this.#sqlite
        .prepare(
          'UPDATE attachments SET expires_at=NULL,updated_at=? WHERE id IN (SELECT attachment_id FROM message_attachments WHERE session_id=? AND entry_id=?)'
        )
        .run(now, sessionId, entryId);
    })();
  }

  /**
   * Lists unresolved prompt request identities for one Session during crash recovery.
   */
  public listPendingReservations(sessionId: string): string[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT idempotency_key,result_json FROM attachment_operations WHERE operation='prompt-reservation' AND phase='reserved'`
      )
      .all() as Array<{ idempotency_key: string; result_json: string | null }>;
    return rows
      .filter((row) => {
        try {
          return (JSON.parse(row.result_json ?? '{}') as { sessionId?: string }).sessionId === sessionId;
        } catch {
          return false;
        }
      })
      .map((row) => row.idempotency_key);
  }

  /**
   * Publishes verified derivative indexes and transitions a processing attachment to ready atomically.
   */
  public completeProcessing(input: {
    attachmentId: string;
    manifest: ArtifactManifestV1;
    published: Map<string, { storageKey: string; sha256: string; byteSize: number }>;
    chunks: NormalizedChunkV1[];
    presentationKind: AttachmentResourceDto['presentationKind'];
  }): AttachmentResourceDto {
    const record = this.#record(input.attachmentId);
    if (record === undefined) {
      throw notFound();
    }
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      let chunkDerivativeId: string | undefined;
      for (const output of input.manifest.outputs) {
        const blob = input.published.get(output.localId);
        if (blob === undefined) {
          throw new Error('Verified processor output publication is incomplete.');
        }
        const derivativeId = randomUUID();
        this.#sqlite
          .prepare(
            `INSERT INTO blobs(sha256,storage_key,byte_size,state,created_at)
           VALUES(?,?,?,'published',?)
           ON CONFLICT(sha256) DO UPDATE SET state='published'`
          )
          .run(blob.sha256, blob.storageKey, blob.byteSize, now);
        this.#sqlite
          .prepare(
            `INSERT OR IGNORE INTO attachment_derivatives(id,attachment_id,kind,processor_id,processor_version,source_sha256,mime_type,byte_size,sha256,storage_key,width,height,page_from,page_to,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            derivativeId,
            input.attachmentId,
            output.kind,
            input.manifest.processor.id,
            input.manifest.processor.version,
            input.manifest.sourceSha256,
            output.mimeType,
            blob.byteSize,
            blob.sha256,
            blob.storageKey,
            typeof output.metadata['width'] === 'number' ? output.metadata['width'] : null,
            typeof output.metadata['height'] === 'number' ? output.metadata['height'] : null,
            typeof output.metadata['pageFrom'] === 'number' ? output.metadata['pageFrom'] : null,
            typeof output.metadata['pageTo'] === 'number' ? output.metadata['pageTo'] : null,
            JSON.stringify(output.metadata),
            now
          );
        const persistedDerivative = this.#sqlite
          .prepare(
            `SELECT id FROM attachment_derivatives
             WHERE attachment_id=? AND kind=? AND processor_id=? AND processor_version=? AND source_sha256=?`
          )
          .get(
            input.attachmentId,
            output.kind,
            input.manifest.processor.id,
            input.manifest.processor.version,
            input.manifest.sourceSha256
          ) as { id: string } | undefined;
        if (persistedDerivative === undefined) {
          throw new Error('Verified processor derivative publication is incomplete.');
        }
        if (output.kind === 'chunks-jsonl') {
          chunkDerivativeId = persistedDerivative.id;
        }
      }
      if (chunkDerivativeId !== undefined) {
        for (const chunk of input.chunks) {
          this.#sqlite
            .prepare(
              `INSERT OR IGNORE INTO attachment_chunks(attachment_id,derivative_id,ordinal,source_locator_json,text,character_count,token_estimate) VALUES(?,?,?,?,?,?,?)`
            )
            .run(
              input.attachmentId,
              chunkDerivativeId,
              chunk.ordinal,
              JSON.stringify(chunk.locator),
              chunk.text,
              chunk.characterCount,
              chunk.tokenEstimate
            );
        }
      }
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
      const changed = this.#sqlite
        .prepare(
          `UPDATE attachments SET status='ready',presentation_kind=?,ready_at=?,expires_at=?,updated_at=?,evidence_json=?,revision=revision+1,failure_code=NULL,failure_retryable=0 WHERE id=? AND status='processing'`
        )
        .run(
          input.presentationKind,
          now,
          expiresAt,
          now,
          mergeDocumentCoverage(record.evidence_json, input.manifest.summary.coverage),
          input.attachmentId
        );
      if (changed.changes !== 1) {
        throw conflict(
          'ATTACHMENT_STATE_CONFLICT',
          'Attachment processing state changed concurrently.',
          true
        );
      }
    })();
    return this.require(record.workspace_id, input.attachmentId);
  }

  /**
   * Returns one derivative row selected by attachment and kind for adapter or preview use.
   */
  public getDerivative(
    attachmentId: string,
    kind: string
  ): { id: string; mimeType: string; byteSize: number; sha256: string; storageKey: string } | undefined {
    const row = this.#sqlite
      .prepare(
        `SELECT id,mime_type,byte_size,sha256,storage_key FROM attachment_derivatives WHERE attachment_id=? AND kind=? ORDER BY created_at DESC LIMIT 1`
      )
      .get(attachmentId, kind) as
      { id: string; mime_type: string; byte_size: number; sha256: string; storage_key: string } | undefined;
    return row === undefined
      ? undefined
      : {
          id: row.id,
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          sha256: row.sha256,
          storageKey: row.storage_key,
        };
  }

  /**
   * Returns chunks authorized by attachment identity with stable source locators.
   */
  public searchChunks(
    attachmentIds: readonly string[],
    query: string,
    limit: number
  ): Array<{ attachmentId: string; locator: unknown; text: string }> {
    if (attachmentIds.length === 0) {
      return [];
    }
    const placeholders = attachmentIds.map(() => '?').join(',');
    const rows = this.#sqlite
      .prepare(
        `SELECT c.attachment_id,c.source_locator_json,c.text FROM attachment_chunks_fts f JOIN attachment_chunks c ON c.id=f.rowid WHERE attachment_chunks_fts MATCH ? AND c.attachment_id IN (${placeholders}) ORDER BY rank LIMIT ?`
      )
      .all(query, ...attachmentIds, limit) as Array<{
      attachment_id: string;
      source_locator_json: string;
      text: string;
    }>;
    return rows.map((row) => ({
      attachmentId: row.attachment_id,
      locator: JSON.parse(row.source_locator_json) as unknown,
      text: row.text,
    }));
  }

  /**
   * Marks a resource deleted with revision CAS while preserving bound message tombstones and idempotent replay.
   */
  public deleteResource(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    idempotencyKey: string
  ): AttachmentResourceDto {
    const fingerprint = hashJson({ workspaceId, id, expectedRevision });
    const operation = this.#operation(idempotencyKey);
    if (operation !== undefined) {
      if (operation.fingerprint !== fingerprint) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with another delete.', false);
      }
      return this.require(workspaceId, id);
    }
    const current = this.require(workspaceId, id);
    if (current.status === 'deleted') {
      return current;
    }
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      const changed = this.#sqlite
        .prepare(
          `UPDATE attachments SET status='deleted',deleted_at=?,updated_at=?,revision=revision+1,failure_code=NULL,failure_retryable=0 WHERE id=? AND workspace_id=? AND revision=? AND status!='deleted'`
        )
        .run(now, now, id, workspaceId, expectedRevision);
      if (changed.changes !== 1) {
        throw conflict('ATTACHMENT_STATE_CONFLICT', 'Attachment revision changed concurrently.', true);
      }
      this.#sqlite
        .prepare(
          `UPDATE attachment_jobs SET status='cancelled',updated_at=? WHERE attachment_id=? AND status='pending'`
        )
        .run(now, id);
      this.#sqlite
        .prepare(
          `INSERT INTO attachment_operations(id,idempotency_key,fingerprint,attachment_id,operation,phase,result_json,created_at,updated_at) VALUES(?,?,?,?,'delete','cleanup-pending',?,?,?)`
        )
        .run(randomUUID(), idempotencyKey, fingerprint, id, JSON.stringify({ id }), now, now);
    })();
    return this.require(workspaceId, id);
  }

  /**
   * Detaches deleted original and derivative references before physical byte cleanup.
   */
  public preparePhysicalCleanup(id: string): string[] {
    const record = this.#record(id);
    if (record === undefined || record.status !== 'deleted') {
      return [];
    }
    const derivativeRows = this.#sqlite
      .prepare('SELECT storage_key FROM attachment_derivatives WHERE attachment_id=?')
      .all(id) as Array<{ storage_key: string }>;
    const original = record.blob_sha256 === null ? undefined : blobKey(record.blob_sha256);
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      this.#sqlite.prepare('DELETE FROM attachment_derivatives WHERE attachment_id=?').run(id);
      this.#sqlite.prepare('UPDATE attachments SET blob_sha256=NULL,updated_at=? WHERE id=?').run(now, id);
      this.#sqlite
        .prepare(
          `UPDATE attachment_operations SET phase='cleaning',updated_at=? WHERE attachment_id=? AND operation='delete' AND phase='cleanup-pending'`
        )
        .run(now, id);
    })();
    return [
      ...new Set([
        ...(original === undefined ? [] : [original]),
        ...derivativeRows.map((row) => row.storage_key),
      ]),
    ];
  }

  /**
   * Returns whether legal hold currently blocks physical byte deletion.
   */
  public isLegallyHeld(id: string): boolean {
    return (
      this.#sqlite.prepare('SELECT 1 FROM attachment_legal_holds WHERE attachment_id=?').get(id) !== undefined
    );
  }

  /**
   * Records a held tombstone without restoring user access to its bytes.
   */
  public deferCleanupForLegalHold(id: string): void {
    this.#sqlite
      .prepare(
        `UPDATE attachment_operations SET phase='held',updated_at=?
       WHERE attachment_id=? AND operation='delete' AND phase IN ('cleanup-pending','cleaning')`
      )
      .run(new Date().toISOString(), id);
  }

  /**
   * Applies or releases legal hold and returns whether cleanup must resume.
   */
  public setLegalHold(id: string, reason: string | undefined): boolean {
    if (this.#record(id) === undefined) {
      throw notFound();
    }
    const now = new Date().toISOString();
    if (reason !== undefined) {
      this.#sqlite
        .prepare(
          `INSERT INTO attachment_legal_holds(attachment_id,reason,created_at) VALUES(?,?,?)
         ON CONFLICT(attachment_id) DO UPDATE SET reason=excluded.reason`
        )
        .run(id, reason, now);
      return false;
    }
    return this.#sqlite.transaction(() => {
      this.#sqlite.prepare('DELETE FROM attachment_legal_holds WHERE attachment_id=?').run(id);
      const changed = this.#sqlite
        .prepare(
          `UPDATE attachment_operations SET phase='cleanup-pending',updated_at=?
         WHERE attachment_id=? AND operation='delete' AND phase='held'`
        )
        .run(now, id);
      return changed.changes > 0;
    })();
  }

  /**
   * Records model delivery metadata without storing attachment content or provider credentials.
   */
  public auditAgentDelivery(input: {
    attachmentIds: readonly string[];
    provider?: string;
    modelId?: string;
    sessionId: string;
    requestId: string;
  }): void {
    const statement = this.#sqlite.prepare(
      `INSERT INTO attachment_audit_events(
         attachment_id,event_type,provider,model_id,session_id,request_id,created_at
       ) VALUES(?,'agent-delivery',?,?,?,?,?)`
    );
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      for (const id of input.attachmentIds) {
        statement.run(
          id,
          input.provider ?? null,
          input.modelId ?? null,
          input.sessionId,
          input.requestId,
          now
        );
      }
    })();
  }

  /**
   * Marks the logical delete operation fully cleaned after all referenced bytes are gone.
   */
  public completePhysicalCleanup(id: string): void {
    this.#sqlite
      .prepare(
        `UPDATE attachment_operations SET phase='committed',updated_at=? WHERE attachment_id=? AND operation='delete' AND phase IN ('cleanup-pending','cleaning')`
      )
      .run(new Date().toISOString(), id);
  }

  /**
   * Lists tombstones whose physical cleanup operation still needs a durable job.
   */
  public listPendingCleanupIds(): string[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT DISTINCT attachment_id FROM attachment_operations
       WHERE operation='delete' AND phase IN ('cleanup-pending','cleaning') AND attachment_id IS NOT NULL`
        )
        .all() as Array<{ attachment_id: string }>
    ).map((row) => row.attachment_id);
  }

  /**
   * Lists expired unbound resources eligible for automatic logical deletion.
   */
  public listRetentionCandidates(
    now: string,
    limit: number
  ): Array<{
    id: string;
    workspaceId: string;
    revision: number;
  }> {
    return this.#sqlite
      .prepare(
        `SELECT a.id,a.workspace_id,a.revision
       FROM attachments a
       WHERE a.expires_at IS NOT NULL AND a.expires_at<=? AND a.status IN ('ready','failed')
         AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id=a.id)
       ORDER BY a.expires_at LIMIT ?`
      )
      .all(now, limit)
      .map((candidate) => {
        const row = candidate as { id: string; workspace_id: string; revision: number };
        return { id: row.id, workspaceId: row.workspace_id, revision: row.revision };
      });
  }

  /**
   * Prunes terminal journal and job records after their thirty-day audit window.
   */
  public pruneTerminalRecords(cutoff: string): { operations: number; jobs: number } {
    const operations = this.#sqlite
      .prepare(
        `DELETE FROM attachment_operations
       WHERE updated_at<? AND phase='committed' AND operation!='prompt-reservation'`
      )
      .run(cutoff).changes;
    const jobs = this.#sqlite
      .prepare(
        `DELETE FROM attachment_jobs
       WHERE updated_at<? AND status IN ('succeeded','failed','cancelled')`
      )
      .run(cutoff).changes;
    return { operations, jobs };
  }

  /**
   * Re-enters processing only from a retryable failed state under revision CAS.
   */
  public retryResource(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    idempotencyKey: string
  ): AttachmentResourceDto {
    const fingerprint = hashJson({ workspaceId, id, expectedRevision });
    const operation = this.#operation(idempotencyKey);
    if (operation !== undefined) {
      if (operation.fingerprint !== fingerprint) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with another retry.', false);
      }
      return this.require(workspaceId, id);
    }
    const current = this.require(workspaceId, id);
    if (current.status !== 'failed' || current.error?.retryable !== true) {
      throw conflict('ATTACHMENT_STATE_CONFLICT', 'Attachment is not eligible for retry.', false);
    }
    const now = new Date().toISOString();
    this.#sqlite.transaction(() => {
      const changed = this.#sqlite
        .prepare(
          `UPDATE attachments SET status='processing',failure_code=NULL,failure_retryable=0,updated_at=?,revision=revision+1 WHERE id=? AND workspace_id=? AND revision=? AND status='failed' AND failure_retryable=1`
        )
        .run(now, id, workspaceId, expectedRevision);
      if (changed.changes !== 1) {
        throw conflict('ATTACHMENT_STATE_CONFLICT', 'Attachment revision changed concurrently.', true);
      }
      this.#sqlite
        .prepare(
          `INSERT INTO attachment_operations(id,idempotency_key,fingerprint,attachment_id,operation,phase,result_json,created_at,updated_at) VALUES(?,?,?,?,'retry','committed',?,?,?)`
        )
        .run(randomUUID(), idempotencyKey, fingerprint, id, JSON.stringify({ id }), now, now);
    })();
    return this.require(workspaceId, id);
  }

  /**
   * Batch-loads stable message attachment projections grouped by entry id without reading Blob bytes.
   */
  public listMessageAttachments(sessionId: string): Map<string, MessageAttachmentDto[]> {
    const rows = this.#sqlite
      .prepare(
        `SELECT ma.entry_id,ma.presentation_json,a.status FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id WHERE ma.session_id=? ORDER BY ma.entry_id,ma.ordinal`
      )
      .all(sessionId) as Array<{ entry_id: string; presentation_json: string; status: string }>;
    const result = new Map<string, MessageAttachmentDto[]>();
    for (const row of rows) {
      const stored = MessageAttachmentSchema.parse(JSON.parse(row.presentation_json));
      const projection =
        row.status === 'ready'
          ? stored
          : {
              ...stored,
              availability: row.status === 'deleted' ? ('deleted' as const) : ('unavailable' as const),
              previewKind: undefined,
              previewLanguage: undefined,
              previewUrl: undefined,
              contentUrl: undefined,
              capabilities: { canPreview: false, canPlay: false, canDownload: false },
            };
      result.set(row.entry_id, [...(result.get(row.entry_id) ?? []), projection]);
    }
    return result;
  }

  /**
   * Returns the persisted internal row required by Blob and processing orchestration.
   */
  public getRecord(id: string): AttachmentRecord | undefined {
    return this.#record(id);
  }

  /**
   * Reads one idempotency journal row.
   */
  #operation(
    key: string
  ):
    | { fingerprint: string; attachment_id: string | null; operation: string; result_json: string | null }
    | undefined {
    return this.#sqlite
      .prepare(
        'SELECT fingerprint,attachment_id,operation,result_json FROM attachment_operations WHERE idempotency_key=?'
      )
      .get(key) as
      | { fingerprint: string; attachment_id: string | null; operation: string; result_json: string | null }
      | undefined;
  }

  /**
   * Reads one raw attachment row for repository-internal decisions.
   */
  #record(id: string): AttachmentRecord | undefined {
    return this.#sqlite.prepare('SELECT * FROM attachments WHERE id=?').get(id) as
      AttachmentRecord | undefined;
  }
}

/**
 * Converts a row into the sole shared runtime DTO.
 */
function toDto(row: AttachmentRecord): AttachmentResourceDto {
  return AttachmentResourceSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.original_name,
    coverage: readDocumentCoverage(row.evidence_json),
    ...(row.declared_mime === null ? {} : { declaredMediaType: row.declared_mime }),
    ...(row.detected_mime === null ? {} : { detectedMediaType: row.detected_mime }),
    byteSize: row.byte_size,
    ...(row.sha256 === null ? {} : { sha256: row.sha256 }),
    status: row.status,
    revision: row.revision,
    ...(row.classification === null ? {} : { classification: row.classification }),
    ...(row.presentation_kind === null ? {} : { presentationKind: row.presentation_kind }),
    ...(row.failure_code === null
      ? {}
      : {
          error: {
            code: externalFailure(row.failure_code),
            message: 'Attachment processing did not complete.',
            retryable: row.failure_retryable === 1,
          },
        }),
    capabilities: capabilities(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.ready_at === null ? {} : { readyAt: row.ready_at }),
  });
}

/**
 * Freezes the message presentation selected by the Host.
 */
function toMessageDto(row: AttachmentRecord): MessageAttachmentDto {
  const presentationKind = row.presentation_kind ?? 'file';
  const previewLanguage = messagePreviewLanguage(row);
  const previewKind = messagePreviewKind(row, previewLanguage);
  const caps = messageCapabilities(row, previewKind);
  const base = `/api/workspaces/${encodeURIComponent(row.workspace_id)}/attachments/${encodeURIComponent(row.id)}`;
  return MessageAttachmentSchema.parse({
    id: row.id,
    name: row.original_name,
    coverage: readDocumentCoverage(row.evidence_json),
    detectedMediaType: row.detected_mime ?? 'application/octet-stream',
    byteSize: row.byte_size,
    presentationKind,
    availability: row.status === 'deleted' ? 'deleted' : 'available',
    ...(previewKind === undefined ? {} : { previewKind }),
    ...(previewKind === 'code' && previewLanguage !== undefined ? { previewLanguage } : {}),
    ...(caps.canPreview && presentationKind === 'image' ? { previewUrl: `${base}/preview` } : {}),
    ...(caps.canDownload || caps.canPlay ? { contentUrl: `${base}/content` } : {}),
    capabilities: caps,
  });
}

const MAX_TEXT_PREVIEW_BYTES = 5 * 1024 * 1024;
const CODE_PREVIEW_MEDIA_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/typescript',
  'text/javascript',
  'text/json',
  'text/plain',
  'text/x-python',
  'text/x-source-code',
]);
const CODE_PREVIEW_LANGUAGES: Record<string, NonNullable<MessageAttachmentDto['previewLanguage']>> = {
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  py: 'python',
  rs: 'rust',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  yaml: 'yaml',
  yml: 'yaml',
};

/**
 * Selects a stable Monaco language only from the Host-verified filename and media type pair.
 */
function messagePreviewLanguage(row: AttachmentRecord): MessageAttachmentDto['previewLanguage'] {
  if (row.detected_mime === null || !CODE_PREVIEW_MEDIA_TYPES.has(row.detected_mime)) {
    return undefined;
  }
  const extension = row.original_name.toLowerCase().match(/\.([^.]+)$/u)?.[1];
  return extension === undefined ? undefined : CODE_PREVIEW_LANGUAGES[extension];
}

/**
 * Selects the only message preview modes the Host currently guarantees safe and bounded.
 */
function messagePreviewKind(
  row: AttachmentRecord,
  previewLanguage: MessageAttachmentDto['previewLanguage']
): MessageAttachmentDto['previewKind'] {
  if (row.status !== 'ready') {
    return undefined;
  }
  if (row.presentation_kind === 'image') {
    return 'image';
  }
  if (
    row.presentation_kind === 'file' &&
    row.detected_mime === 'text/markdown' &&
    row.byte_size <= MAX_TEXT_PREVIEW_BYTES
  ) {
    return 'markdown';
  }
  if (
    row.presentation_kind === 'file' &&
    row.detected_mime !== null &&
    CODE_PREVIEW_MEDIA_TYPES.has(row.detected_mime) &&
    previewLanguage !== undefined &&
    row.byte_size <= MAX_TEXT_PREVIEW_BYTES
  ) {
    return 'code';
  }
  return undefined;
}

/**
 * Derives message-card operations without widening the image derivative endpoint contract.
 */
function messageCapabilities(
  row: AttachmentRecord,
  previewKind: MessageAttachmentDto['previewKind']
): MessageAttachmentDto['capabilities'] {
  const available = row.status === 'ready';
  return {
    canPreview: available && previewKind !== undefined,
    canPlay: available && (row.presentation_kind === 'audio' || row.presentation_kind === 'video'),
    canDownload: available,
  };
}

/**
 * Derives externally visible operations from ready/deleted state and frozen presentation.
 */
function capabilities(row: AttachmentRecord): AttachmentResourceDto['capabilities'] {
  const available = row.status === 'ready';
  return {
    canPreview: available && row.presentation_kind === 'image',
    canPlay: available && (row.presentation_kind === 'audio' || row.presentation_kind === 'video'),
    canDownload: available,
  };
}
/**
 * Hashes a canonical JSON-compatible input for operation idempotency.
 */
function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/**
 * Maps internal diagnostics into the deliberately finite external failure vocabulary.
 */
function externalFailure(code: string): NonNullable<AttachmentResourceDto['error']>['code'] {
  if (code.includes('LIMIT')) {
    return 'ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED';
  }
  if (code.includes('TYPE')) {
    return 'ATTACHMENT_TYPE_UNSUPPORTED';
  }
  if (code.includes('MISMATCH') || code.includes('CONTAINER') || code.includes('CONTENT')) {
    return 'ATTACHMENT_FORMAT_EVIDENCE_MISMATCH';
  }
  return 'ATTACHMENT_PROCESSING_FAILED';
}
/**
 * Creates a safe state-conflict failure.
 */
function conflict(code: string, message: string, retryable: boolean): ApplicationError {
  return new ApplicationError(code, message, { statusCode: 409, retryable });
}
/**
 * Creates a non-enumerating resource failure.
 */
function notFound(): ApplicationError {
  return new ApplicationError('ATTACHMENT_NOT_FOUND', 'Attachment was not found.', {
    statusCode: 404,
    retryable: false,
  });
}

/**
 * Derives the canonical internal Blob key for a validated database digest.
 */
function blobKey(sha256: string): string {
  return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}
