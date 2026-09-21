/**
 * @author root
 * @description Adapts @tus/server DataStore operations to the project-owned SQLite offset and LocalFileBlobStore staging authorities.
 */

import { DataStore, Upload } from '@tus/server';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { LocalFileBlobStore } from '../../lib/attachment-storage/local-file-blob-store.js';
import type { AttachmentsRepository } from './attachments.repository.js';
import type { Readable } from 'node:stream';

const UPLOAD_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Implements tus creation, termination, expiration, and sequential append without making tus its persistence authority.
 */
export class SqliteTusDataStore extends DataStore {
  public override extensions = ['creation', 'termination', 'expiration'];

  /**
   * @param repository SQLite attachment and offset repository.
   * @param blobs Managed staging and Blob filesystem.
   */
  public constructor(
    private readonly repository: AttachmentsRepository,
    private readonly blobs: LocalFileBlobStore
  ) {
    super();
  }

  /**
   * Creates a durable upload record from metadata validated by the tus server hook.
   */
  public override async create(file: Upload): Promise<Upload> {
    const metadata = file.metadata ?? {};
    const size = file.size;
    if (size === undefined) {
      throw invalid('Deferred upload length is not supported.');
    }
    const workspaceId = metadata['octopusWorkspaceId'];
    const idempotencyKey = metadata['octopusIdempotencyKey'];
    const ownerId = metadata['octopusOwnerId'];
    const filename = metadata['filename'];
    if (
      workspaceId === null ||
      workspaceId === undefined ||
      idempotencyKey === null ||
      idempotencyKey === undefined ||
      ownerId === null ||
      ownerId === undefined ||
      filename === null ||
      filename === undefined
    ) {
      throw invalid('Upload metadata is incomplete.');
    }
    const stagingKey = await this.blobs.createStaging();
    const expiresAt = new Date(Date.now() + UPLOAD_RETENTION_MS).toISOString();
    const dto = this.repository.createUpload({
      id: file.id,
      workspaceId,
      ownerId,
      name: filename,
      ...(metadata['declaredMediaType'] === null || metadata['declaredMediaType'] === undefined
        ? {}
        : { declaredMediaType: metadata['declaredMediaType'] }),
      uploadLength: size,
      stagingKey,
      expiresAt,
      idempotencyKey,
    });
    return new Upload({
      id: dto.id,
      size,
      offset: 0,
      metadata: publicMetadata(metadata),
      creation_date: dto.createdAt,
    });
  }

  /**
   * Removes only an unfinished staging upload.
   */
  public override async remove(id: string): Promise<void> {
    const stagingKey = this.repository.terminateUpload(id);
    if (stagingKey !== undefined) {
      await this.blobs.delete(stagingKey);
    }
  }

  /**
   * Appends a bounded request stream at the authoritative exact offset.
   */
  public override async write(source: Readable, id: string, offset: number): Promise<number> {
    const upload = this.repository.getUpload(id);
    if (upload === undefined) {
      throw missingUpload(this.repository, id);
    }
    if (upload.uploadOffset !== offset) {
      throw new ApplicationError(
        'UPLOAD_OFFSET_CONFLICT',
        'Upload offset does not match the Server offset.',
        { statusCode: 409, retryable: true }
      );
    }
    const nextOffset = await this.blobs.append(upload.stagingKey, source, offset);
    if (nextOffset > upload.uploadLength) {
      throw new ApplicationError(
        'ATTACHMENT_SIZE_LIMIT_EXCEEDED',
        'Upload chunk exceeded the declared length.',
        { statusCode: 413 }
      );
    }
    this.repository.updateUploadOffset(id, offset, nextOffset);
    return nextOffset;
  }

  /**
   * Returns the SQLite offset used by HEAD and PATCH preconditions.
   */
  public override getUpload(id: string): Promise<Upload> {
    const upload = this.repository.getUpload(id);
    if (upload === undefined) {
      throw missingUpload(this.repository, id);
    }
    return Promise.resolve(
      new Upload({
        id,
        size: upload.uploadLength,
        offset: upload.uploadOffset,
        metadata: upload.metadata,
        creation_date: new Date(Date.parse(upload.expiresAt) - UPLOAD_RETENTION_MS).toISOString(),
      })
    );
  }

  /**
   * Rejects the unsupported deferred-length extension.
   */
  public override declareUploadLength(): Promise<void> {
    return Promise.reject(invalid('Deferred upload length is not supported.'));
  }

  /**
   * Deletes expired staging uploads using the same tombstone path as explicit termination.
   */
  public override async deleteExpired(): Promise<number> {
    const ids = this.repository.listExpiredUploadIds(new Date().toISOString());
    for (const id of ids) {
      await this.remove(id);
    }
    return ids.length;
  }

  /**
   * Returns the fixed unfinished-upload retention used by tus expiration headers.
   */
  public override getExpiration(): number {
    return UPLOAD_RETENTION_MS;
  }
}

/**
 * Removes Host-only metadata before returning an Upload projection.
 */
function publicMetadata(metadata: Record<string, string | null>): Record<string, string | null> {
  return { filename: metadata['filename'] ?? null, declaredMediaType: metadata['declaredMediaType'] ?? null };
}
/**
 * Creates a safe invalid-request domain error.
 */
function invalid(message: string): ApplicationError {
  return new ApplicationError('ATTACHMENT_REQUEST_INVALID', message, { statusCode: 400, retryable: false });
}

/**
 * Maps expired tus identities separately from unauthorized or unknown resources.
 */
function missingUpload(repository: AttachmentsRepository, id: string): ApplicationError {
  return repository.isExpiredUpload(id)
    ? new ApplicationError('UPLOAD_EXPIRED', 'Upload session expired.', { statusCode: 410, retryable: true })
    : new ApplicationError('ATTACHMENT_NOT_FOUND', 'Upload was not found.', { statusCode: 404 });
}
