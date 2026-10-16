/**
 * @author Codex
 * @description Coordinates task-bound binary transfers, durable publication facts and owned material cleanup.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable, Writable } from 'node:stream';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  transferUploadSchema,
  transferDownloadSchema,
  transferIdSchema,
  transferResultSchema,
  isTransferTerminal,
  type TransferResult,
} from './transfer-inputs';
import type { TransferControlName } from './transfer-inputs';
import { BasicToolError } from '../basic/basic-inputs';
import type { TransferFiles } from './transfer-files';
import type { TransferStore } from './transfer-store';
import type { TransferRecord } from './transfer-store';
import { transferRecordSchema } from './transfer-store';
import { defaultTransferSettings, transferSettingsSchema } from '../../contracts/transfer-settings';
import type { TransferSettings } from '../../contracts/transfer-settings';

export type TransferAuthorization = (
  owner: string,
  task: string,
  upload: boolean,
  active: boolean,
  touch: boolean
) => { expiresAt: number };

/**
 * Hashes the canonical preparation request without exposing file content to tools.
 */
function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export class TransferService {
  private readonly limits: TransferSettings;
  private readonly tokenKey = randomBytes(32);
  private readonly streams = new Map<string, AbortController>();

  /**
   * Returns limits owned by this Executor; Agent-local storage remains the caller responsibility.
   */
  settings(): TransferSettings {
    return { ...this.limits };
  }
  private readonly work = new Map<string, Promise<unknown>>();
  private readonly cancelled = new Set<string>();
  private readonly admissions = new Map<string, Promise<unknown>>();
  /**
   * Shares the unique TaskAuthority through a narrow authorization callback on every operation.
   */
  constructor(
    readonly store: TransferStore,
    private readonly files: TransferFiles,
    private readonly authorize: TransferAuthorization,
    settings: TransferSettings = defaultTransferSettings
  ) {
    this.limits = Object.freeze(transferSettingsSchema.parse(settings));
  }

  /**
   * Restores facts only, never old tasks or byte operations; uncertain commits preserve evidence.
   */
  async recover(): Promise<void> {
    for (const record of this.store.records.values()) {
      if (record.directory !== this.files.location(record.transferId, record.path, record.direction)) {
        throw new Error('Invalid transfer material path');
      }
      if (!isTransferTerminal(record.status) || record.status === 'unknown') {
        if (
          (record.status === 'committing' || record.status === 'unknown') &&
          record.direction === 'upload' &&
          record.materialIdentity
        ) {
          const target = await this.files.native.inspect(record.path);
          const digest =
            target.ok && target.identity === record.materialIdentity
              ? await this.files.native.transferDigest(record.path, record.totalBytes)
              : undefined;
          if (digest?.ok && digest.digest === record.sha256 && digest.identity === record.materialIdentity) {
            record.status = 'completed';
            record.destinationEffect = 'applied';
          } else {
            record.status = 'unknown';
            record.destinationEffect = 'unknown';
          }
        } else if (record.status === 'unknown' || record.status === 'committing') {
          record.status = 'unknown';
          record.destinationEffect = 'unknown';
        } else {
          record.status = 'failed';
          record.errorCode = 'PROCESS_INTERRUPTED';
        }
        await this.store.save(record);
      }
      if (record.status !== 'unknown') {
        await this.cleanup(record);
      }
    }
  }

  /**
   * Holds task execution while any transfer has not reached a known terminal state.
   */
  active(taskId: string): boolean {
    return [...this.store.records.values()].some(
      (r) =>
        r.taskId === taskId &&
        (!isTransferTerminal(r.status) ||
          r.status === 'unknown' ||
          this.work.has(r.transferId) ||
          this.admissions.has(r.transferId))
    );
  }

  /**
   * Counts preparation, streaming and publication as activity; byte streams have a separate idle deadline.
   */
  working(taskId: string): boolean {
    return [...this.store.records.values()].some((r) => r.taskId === taskId && this.work.has(r.transferId));
  }

  /**
   * Routes model-visible metadata operations; bytes and publication do not require a completion tool.
   */
  async control(owner: string, name: TransferControlName, input: unknown): Promise<TransferResult> {
    if (name === 'file_upload_prepare' || name === 'file_download_prepare') {
      return this.create(owner, input, name === 'file_upload_prepare' ? 'upload' : 'download');
    }
    const { transferId } = transferIdSchema.parse(input);
    const record = this.require(owner, transferId, false);
    if (name === 'file_transfer_cancel') {
      await this.cancel(record);
    }
    return this.public(record);
  }

  /**
   * Issues metadata-only credentials for one ready transfer and the verified HTTP listener origin.
   * Credentials are derived from an in-memory key and never enter the durable record or local UI.
   */
  content(owner: string, id: string, origin: string) {
    const record = this.require(owner, id, false);
    if (record.status !== 'ready' || this.work.has(id)) {
      return undefined;
    }
    this.require(owner, id, true);
    return {
      method: record.direction === 'upload' ? 'PUT' : 'GET',
      url: origin + '/transfers/' + id + '/content',
      headers: { Authorization: 'Bearer ' + this.token(record, origin) },
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Authenticates a byte request independently of long-lived MCP device credentials.
   */
  authenticate(id: string, credential: string, origin: string, method: string): string {
    const record = this.store.records.get(id);
    if (!record || !/^[a-f0-9]{64}$/.test(credential)) {
      throw new BasicToolError('UNAUTHORIZED', 'Invalid transfer credential.');
    }
    const expected = this.token(record, origin);
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(credential))) {
      throw new BasicToolError('UNAUTHORIZED', 'Invalid transfer credential.');
    }
    this.require(record.ownerId, id, true);
    if (method !== (record.direction === 'upload' ? 'PUT' : 'GET')) {
      throw new BasicToolError('FORBIDDEN', 'Transfer credential has a different direction.');
    }
    return record.ownerId;
  }

  /**
   * Pins the credential to this process, listener, owner, task, target, direction and deadline.
   */
  private token(record: TransferRecord, origin: string): string {
    return createHmac('sha256', this.tokenKey)
      .update(
        JSON.stringify([
          origin,
          record.ownerId,
          record.taskId,
          record.transferId,
          record.path,
          record.direction,
          record.totalBytes,
          record.expiresAt,
        ])
      )
      .digest('hex');
  }

  /**
   * Verifies complete staged bytes and records no-clobber publication before reporting success.
   */
  private async publish(record: TransferRecord, digest: string): Promise<void> {
    record.sha256 = digest;
    record.status = 'verifying';
    const staged = await this.files.native.transferDigest(
      join(record.directory, 'content'),
      record.totalBytes
    );
    if (
      !staged.ok ||
      staged.identity !== record.materialIdentity ||
      staged.digest !== digest ||
      (record.expectedSha256 && record.expectedSha256 !== digest)
    ) {
      throw new BasicToolError('DIGEST_MISMATCH', 'Received file checksum differs.');
    }
    this.require(record.ownerId, record.transferId, true);
    record.materialIdentity = staged.identity;
    record.status = 'committing';
    record.destinationEffect = 'unknown';
    await this.store.save(record);
    const result = await this.files.publish(
      record.directory,
      record.path,
      record.directoryIdentity,
      record.materialIdentity
    );
    if (!result.ok) {
      record.status = result.started ? 'unknown' : 'failed';
      record.destinationEffect = result.started ? 'unknown' : 'not_applied';
      record.errorCode = [80, 183].includes(result.nativeCode) ? 'TARGET_EXISTS' : 'PUBLISH_FAILED';
    } else {
      const published = await this.files.native.transferDigest(record.path, record.totalBytes);
      if (published.ok && published.identity === record.materialIdentity && published.digest === digest) {
        record.status = 'completed';
        record.destinationEffect = 'applied';
      } else {
        record.status = 'unknown';
        record.destinationEffect = 'unknown';
        record.errorCode = 'PUBLISHED_FILE_CHANGED';
      }
    }
    await this.store.save(record);
    if (record.status !== 'unknown') {
      await this.cleanup(record);
    }
  }

  /**
   * Reserves synchronously before awaiting path inspection, so concurrent creators cannot race admission.
   */
  private async create(owner: string, request: unknown, direction: 'upload' | 'download') {
    const input = {
      ...transferUploadSchema
        .partial({ totalBytes: true, sha256: true })
        .parse(
          direction === 'upload' ? transferUploadSchema.parse(request) : transferDownloadSchema.parse(request)
        ),
      direction,
    };
    const fingerprint = sha(JSON.stringify(input));
    const prior = [...this.store.records.values()].find(
      (r) => r.ownerId === owner && r.taskId === input.taskId && r.key === input.idempotencyKey
    );
    if (prior) {
      this.require(owner, prior.transferId, false);
      if (prior.fingerprint !== fingerprint) {
        throw new BasicToolError('REQUEST_CONFLICT', 'Transfer key has different input.');
      }
      await this.admissions.get(prior.transferId);
      return this.public(prior);
    }
    const context = this.authorize(owner, input.taskId, input.direction === 'upload', true, true);
    if (input.direction === 'upload' && input.totalBytes! > this.limits.uploadLimitMiB * 1024 ** 2) {
      throw new BasicToolError(
        'TRANSFER_FILE_LIMIT',
        'Upload exceeds the executor configured single-file limit.'
      );
    }
    if (this.active(input.taskId) || this.store.records.size >= 1000) {
      throw new BasicToolError('TRANSFER_BUSY', 'Transfer admission is unavailable.');
    }
    const transferId = randomUUID();
    const record: TransferRecord = {
      transferId,
      taskId: input.taskId,
      ownerId: owner,
      key: input.idempotencyKey,
      fingerprint,
      direction: input.direction,
      path: input.path,
      status: 'preparing',
      totalBytes: input.totalBytes ?? 0,
      expectedSha256: input.sha256,
      transferredBytes: 0,
      destinationEffect: 'not_applied',
      cleanupPending: true,
      expiresAt: context.expiresAt,
      pollAfterMs: 1000,
      directory: this.files.location(transferId, input.path, input.direction),
      reservedBytes: 0,
      updatedAt: Date.now(),
    };
    transferRecordSchema.parse(record);
    this.store.records.set(transferId, record);
    const admission = this.admit(record);
    this.admissions.set(transferId, admission);
    try {
      await admission;
    } finally {
      this.admissions.delete(transferId);
    }
    return this.public(record);
  }

  /**
   * Starts bounded preparation after recording its identity; background failures always become visible outcomes.
   */
  private async admit(record: TransferRecord): Promise<void> {
    await this.store.save(record);
    const preparation = this.exclusive(record, async () => {
      const resolved = await this.files.resolve(record.path, record.direction);
      record.path = resolved.path;
      record.directory = this.files.location(record.transferId, record.path, record.direction);
      if (record.direction === 'download') {
        record.totalBytes = resolved.size;
      }
      const maximum =
        record.direction === 'upload' ? this.limits.uploadLimitMiB : this.limits.downloadLimitMiB;
      if (record.totalBytes > maximum * 1024 ** 2) {
        throw new BasicToolError(
          'TRANSFER_FILE_LIMIT',
          'File exceeds the executor configured direction limit.'
        );
      }
      const used = [...this.store.records.values()].reduce((sum, item) => sum + item.reservedBytes, 0);
      if (used + record.totalBytes > this.limits.temporaryQuotaMiB * 1024 ** 2) {
        throw new BasicToolError('TRANSFER_QUOTA', 'Transfer storage quota exceeded.');
      }
      record.reservedBytes = record.totalBytes;
      await this.store.save(record);
      await this.files.capacity(
        record.direction === 'upload' ? join(record.directory, '..') : this.files.root,
        record.totalBytes
      );
      this.require(record.ownerId, record.transferId, true);
      record.directoryIdentity = await this.files.prepare(record.directory, record.direction === 'upload');
      await this.store.save(record);
      if (record.direction === 'download') {
        const result = await this.files.native.transferSnapshot(
          record.path,
          join(record.directory, 'content'),
          record.totalBytes
        );
        if (!result.ok || result.size !== record.totalBytes) {
          throw new BasicToolError('SOURCE_CHANGED', 'Cannot freeze a stable source file.');
        }
        record.sha256 = result.digest;
      }
      const material = await this.files.native.inspect(join(record.directory, 'content'));
      if (!material.ok || material.directory || material.links !== 1) {
        throw new BasicToolError('STAGING_CHANGED', 'Prepared material is invalid.');
      }
      record.materialIdentity = material.identity;
      this.require(record.ownerId, record.transferId, true);
      record.status = 'ready';
      await this.store.save(record);
    });
    // exclusive records failures; this catch only observes the already recorded rejection.
    void preparation.catch(() => {});
  }

  /**
   * Receives one complete HTTP body with bounded memory; interrupted uploads cannot resume or publish.
   */
  async upload(owner: string, id: string, source: Readable, length: number): Promise<TransferResult> {
    const record = this.require(owner, id, true);
    if (record.direction !== 'upload' || record.status !== 'ready' || length !== record.totalBytes) {
      throw new BasicToolError('INVALID_LENGTH', 'Upload must contain exactly the prepared file length.');
    }
    await this.exclusive(record, async () => {
      let sourceFailure: Error | undefined;
      /**
       * Observes early disconnects while filesystem inspection precedes the stream iterator.
       */
      const sourceError = (error: Error): void => {
        sourceFailure = error;
      };
      this.beginStream(record, source);
      source.on('error', sourceError);
      try {
        await this.files.inspect(record.directory, record.directoryIdentity, record.materialIdentity);
        if (sourceFailure) {
          throw sourceFailure;
        }
        const handle = await open(join(record.directory, 'content'), 'r+');
        const digest = createHash('sha256');
        let saved = 0;
        try {
          for await (const chunk of source) {
            this.require(owner, id, true);
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (record.transferredBytes + bytes.length > record.totalBytes) {
              throw new BasicToolError('INVALID_LENGTH', 'Upload exceeds prepared length.');
            }
            let written = 0;
            while (written < bytes.length) {
              const part = await handle.write(
                bytes,
                written,
                bytes.length - written,
                record.transferredBytes + written
              );
              if (!part.bytesWritten) {
                throw new Error('Short file write');
              }
              written += part.bytesWritten;
            }
            digest.update(bytes);
            record.transferredBytes += bytes.length;
            if (record.transferredBytes - saved >= 16 * 1024 ** 2) {
              await this.store.save(record);
              saved = record.transferredBytes;
            }
          }
          this.require(owner, id, true);
          if (record.transferredBytes !== record.totalBytes) {
            throw new BasicToolError('INVALID_LENGTH', 'Upload was truncated.');
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.publish(record, digest.digest('hex'));
      } finally {
        source.off('error', sourceError);
        this.endStream(id);
      }
    });
    return this.public(record);
  }

  /**
   * Sends one immutable snapshot with backpressure; completion asserts delivery, never Agent-local publication.
   */
  async download(owner: string, id: string, destination: Writable): Promise<void> {
    const record = this.require(owner, id, true);
    if (record.direction !== 'download' || record.status !== 'ready') {
      throw new BasicToolError('TRANSFER_NOT_READY', 'Download is not ready.');
    }
    await this.exclusive(record, async () => {
      const controller = this.beginStream(record, destination);
      try {
        await this.files.inspect(record.directory, record.directoryIdentity, record.materialIdentity);
        await pipeline(this.downloadBlocks(record), destination, { signal: controller.signal });
        record.status = 'completed';
        await this.store.save(record);
        await this.cleanup(record);
      } finally {
        this.endStream(id);
      }
    });
  }

  /**
   * Reads fixed-size blocks as the HTTP destination accepts them and always closes the snapshot handle.
   */
  private async *downloadBlocks(record: TransferRecord): AsyncGenerator<Buffer> {
    const handle = await open(join(record.directory, 'content'), 'r');
    try {
      while (record.transferredBytes < record.totalBytes) {
        this.require(record.ownerId, record.transferId, true);
        const bytes = Buffer.alloc(Math.min(256 * 1024, record.totalBytes - record.transferredBytes));
        const read = await handle.read(bytes, 0, bytes.length, record.transferredBytes);
        if (read.bytesRead !== bytes.length) {
          throw new BasicToolError('STAGING_CHANGED', 'Snapshot was truncated.');
        }
        yield bytes;
        record.transferredBytes += bytes.length;
      }
      this.require(record.ownerId, record.transferId, true);
    } finally {
      await handle.close();
    }
  }

  /**
   * Keeps cancellation and the original task deadline connected to the actual network stream.
   */
  private beginStream(record: TransferRecord, stream: Readable | Writable): AbortController {
    this.require(record.ownerId, record.transferId, true);
    const controller = new AbortController();
    this.streams.set(record.transferId, controller);
    record.status = 'transferring';
    const timer = setTimeout(() => controller.abort(), Math.max(1, record.expiresAt - Date.now()));
    timer.unref();
    controller.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        // The signal/iterator records cancellation; avoid emitting an unhandled error before pipeline attaches.
        stream.destroy();
      },
      { once: true }
    );
    // Cleanup also clears the timer without aborting a successfully completed stream.
    this.streamTimers.set(record.transferId, timer);
    return controller;
  }
  private readonly streamTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Releases the timer and cancellation handle after network and filesystem work have drained.
   */
  private endStream(id: string): void {
    clearTimeout(this.streamTimers.get(id));
    this.streamTimers.delete(id);
    this.streams.delete(id);
  }

  /**
   * Checks ownership before revealing existence, and current task permission before all byte access.
   */
  require(owner: string, id: string, active: boolean): TransferRecord {
    const record = this.store.records.get(id);
    if (!record || record.ownerId !== owner) {
      throw new BasicToolError('TRANSFER_NOT_FOUND', 'Transfer is unavailable.');
    }
    this.authorize(owner, record.taskId, record.direction === 'upload', active, active);
    if (
      active &&
      (Date.now() >= record.expiresAt || this.cancelled.has(id) || isTransferTerminal(record.status))
    ) {
      throw new BasicToolError('TRANSFER_STOPPED', 'Transfer no longer accepts data.');
    }
    return record;
  }

  /**
   * Serializes operations and persists terminal failures without discarding uncertain commit evidence.
   */
  private async exclusive<T>(record: TransferRecord, action: () => Promise<T>): Promise<T> {
    if (this.work.has(record.transferId)) {
      throw new BasicToolError('TRANSFER_BUSY', 'Transfer has an operation in progress.');
    }
    const pending = Promise.resolve()
      .then(action)
      .catch(async (error: unknown) => {
        if (record.status === 'committing' || record.destinationEffect === 'applied') {
          record.status = 'unknown';
          record.destinationEffect = 'unknown';
        } else {
          record.status =
            Date.now() >= record.expiresAt
              ? 'expired'
              : this.cancelled.has(record.transferId)
                ? 'cancelled'
                : 'failed';
        }
        record.errorCode = error instanceof BasicToolError ? error.code : 'TRANSFER_FAILED';
        await this.store.save(record);
        if (record.status !== 'unknown') {
          await this.cleanup(record);
        }
        throw error;
      })
      .finally(() => {
        this.work.delete(record.transferId);
      });
    this.work.set(record.transferId, pending);
    return pending;
  }

  /**
   * Closes byte admission before waiting for native work; publication already entered must finish truthfully.
   */
  private async cancel(record: TransferRecord): Promise<void> {
    this.cancelled.add(record.transferId);
    this.streams.get(record.transferId)?.abort();
    await this.admissions.get(record.transferId)?.catch(() => {});
    await this.work.get(record.transferId)?.catch(() => {});
    if (!isTransferTerminal(record.status)) {
      record.status = Date.now() >= record.expiresAt ? 'expired' : 'cancelled';
      await this.store.save(record);
    }
    if (record.status !== 'unknown') {
      await this.cleanup(record);
    }
  }

  /**
   * Drains all owned transfer work before TaskAuthority releases global task admission.
   */
  async stopTask(taskId: string): Promise<void> {
    for (const record of this.store.records.values()) {
      if (record.taskId === taskId) {
        await this.cancel(record);
      }
    }
    if (this.active(taskId)) {
      throw new BasicToolError('TRANSFER_UNKNOWN', 'Transfer publication requires inspection.');
    }
  }

  /**
   * Releases quota only after physical cleanup; failed cleanup remains visible and accounted for.
   */
  private async cleanup(record: TransferRecord): Promise<void> {
    if (!record.cleanupPending && record.reservedBytes === 0) {
      return;
    }
    try {
      await this.files.cleanup(record.directory, record.directoryIdentity, record.materialIdentity);
      record.cleanupPending = false;
      record.reservedBytes = 0;
    } catch {
      record.cleanupPending = true;
    }
    await this.store.save(record);
  }

  /**
   * Projects metadata only, omitting material paths, credential identity and operation fingerprints.
   */
  private public(record: TransferRecord) {
    if (record.status !== 'unknown' && record.finishedAt && Date.now() - record.finishedAt >= 86400000) {
      throw new BasicToolError(
        'TRANSFER_RESULT_EXPIRED',
        'Transfer result query retention expired; the operation key remains reserved.'
      );
    }
    const result = transferResultSchema.strip().parse(record);
    if (this.work.has(record.transferId) && result.status === 'ready') {
      result.status = 'preparing';
    }
    if (this.work.has(record.transferId) && result.status === 'completed') {
      result.status = 'committing';
    }
    return result;
  }
}
