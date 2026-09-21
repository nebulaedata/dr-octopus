/**
 * @author Codex
 * @description Appends permission review records to lock-free process-owned bounded log segments.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertManagedPermissionReviewLogPath,
  createPermissionReviewSegmentFilename,
  createPermissionReviewShardId,
  getPermissionReviewLogDirectory,
  getRegularPermissionReviewLogSize,
  readManagedPermissionReviewLogFiles,
} from './permission-review-log-files.js';
import { prunePermissionReviewLogHistory } from './permission-review-log-retention.js';

const DEFAULT_MAX_SEGMENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_HISTORY_FILES = 4;
const DEFAULT_MAX_HISTORY_BYTES = 20 * 1024 * 1024;
const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;
const PROCESS_STARTED_AT = Date.now();
const PROCESS_INSTANCE_ID = randomUUID().replaceAll('-', '').slice(0, 8);

/**
 * Overrides storage limits and process identity for deterministic tests.
 */
export interface PermissionReviewLogStorageOptions {
  maxSegmentBytes?: number;
  maxHistoryFiles?: number;
  maxHistoryBytes?: number;
  processStartedAt?: number;
  processId?: number;
  instanceId?: string;
  isProcessAlive?: (processId: number) => boolean;
}

/**
 * Appends permission events to one process-owned shard and prunes closed history opportunistically.
 */
export class ShardedPermissionReviewLogStorage {
  private readonly logsDir: string;
  private readonly shardId: string;
  private readonly maxSegmentBytes: number;
  private readonly maxHistoryFiles: number;
  private readonly maxHistoryBytes: number;
  private readonly isProcessAlive: (processId: number) => boolean;
  private segment: number | undefined;
  private pruned = false;

  /**
   * Creates storage for one unique process shard without touching disk.
   *
   * @param agentDir Pi Agent user directory.
   * @param options Optional deterministic limits and identity.
   */
  public constructor(agentDir: string, options: PermissionReviewLogStorageOptions = {}) {
    const processStartedAt = options.processStartedAt ?? PROCESS_STARTED_AT;
    const processId = options.processId ?? process.pid;
    const instanceId = options.instanceId ?? PROCESS_INSTANCE_ID;
    validateStorageOptions(options, processStartedAt, processId, instanceId);
    this.logsDir = getPermissionReviewLogDirectory(agentDir);
    this.shardId = createPermissionReviewShardId(processStartedAt, processId, instanceId);
    this.maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    this.maxHistoryFiles = options.maxHistoryFiles ?? DEFAULT_MAX_HISTORY_FILES;
    this.maxHistoryBytes = options.maxHistoryBytes ?? DEFAULT_MAX_HISTORY_BYTES;
    this.isProcessAlive = options.isProcessAlive ?? isProcessAlive;
  }

  /**
   * Persists one complete JSONL record without sharing a writable file with another process.
   *
   * @param line Serialized review entry without a trailing newline.
   * @returns A non-fatal retention warning, otherwise undefined.
   */
  public append(line: string): string | undefined {
    mkdirSync(this.logsDir, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });
    restrictExistingPathToOwner(this.logsDir, OWNER_ONLY_DIRECTORY_MODE);
    this.segment ??= findLatestSegment(this.logsDir, this.shardId);

    const record = `${line}\n`;
    const recordBytes = Buffer.byteLength(record, 'utf8');
    let activePath = this.getActivePath();
    const activeSize = getRegularPermissionReviewLogSize(activePath);
    let rotated = false;
    if (activeSize > 0 && activeSize + recordBytes > this.maxSegmentBytes) {
      this.segment += 1;
      activePath = this.getActivePath();
      rotated = true;
    }

    assertManagedPermissionReviewLogPath(activePath, this.logsDir);
    appendFileSync(activePath, record, { encoding: 'utf8', mode: OWNER_ONLY_FILE_MODE });
    restrictExistingPathToOwner(activePath, OWNER_ONLY_FILE_MODE);

    if (!this.pruned || rotated) {
      this.pruned = true;
      return this.pruneHistory();
    }
    return undefined;
  }

  /**
   * Converts a cleanup failure into a non-fatal warning after the event is durable.
   *
   * @returns Cleanup warning or undefined.
   */
  private pruneHistory(): string | undefined {
    try {
      prunePermissionReviewLogHistory(this.logsDir, {
        maxHistoryFiles: this.maxHistoryFiles,
        maxHistoryBytes: this.maxHistoryBytes,
        currentShardId: this.shardId,
        isProcessAlive: this.isProcessAlive,
      });
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to prune permission review logs in '${this.logsDir}': ${message}`;
    }
  }

  /**
   * Resolves the active filename from the current shard segment.
   *
   * @returns Absolute current segment path.
   */
  private getActivePath(): string {
    return join(this.logsDir, createPermissionReviewSegmentFilename(this.shardId, this.segment ?? 0));
  }
}

/**
 * Finds the newest existing segment owned by one shard.
 *
 * @param logsDir Permission review directory.
 * @param shardId Process shard identity.
 * @returns Highest segment or zero for a new shard.
 */
function findLatestSegment(logsDir: string, shardId: string): number {
  return readManagedPermissionReviewLogFiles(logsDir)
    .filter((file) => file.shardId === shardId)
    .reduce((latest, file) => Math.max(latest, file.segment), 0);
}

/**
 * Validates internal storage overrides before they influence paths or deletion bounds.
 *
 * @param options Candidate limits.
 * @param processStartedAt Candidate process start epoch.
 * @param processId Candidate process id.
 * @param instanceId Candidate random instance id.
 */
function validateStorageOptions(
  options: PermissionReviewLogStorageOptions,
  processStartedAt: number,
  processId: number,
  instanceId: string
): void {
  const positiveIntegers = [
    options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES,
    options.maxHistoryBytes ?? DEFAULT_MAX_HISTORY_BYTES,
    processStartedAt,
    processId,
  ];
  if (positiveIntegers.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError('Permission review storage sizes and process identity must be positive integers.');
  }
  const maxHistoryFiles = options.maxHistoryFiles ?? DEFAULT_MAX_HISTORY_FILES;
  if (!Number.isSafeInteger(maxHistoryFiles) || maxHistoryFiles < 0) {
    throw new RangeError('Permission review history file count must be a non-negative integer.');
  }
  if (!/^[a-f0-9]{8}$/u.test(instanceId)) {
    throw new TypeError('Permission review process instance id must contain eight lowercase hex characters.');
  }
}

/**
 * Determines whether an operating-system process may still own its latest segment.
 *
 * @param processId Candidate process id.
 * @returns True when alive or when the platform cannot safely prove termination.
 */
function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ESRCH'
    );
  }
}

/**
 * Tightens POSIX permissions without making Windows ACL behavior a storage dependency.
 *
 * @param target Existing file or directory.
 * @param mode Owner-only POSIX mode.
 */
function restrictExistingPathToOwner(target: string, mode: number): void {
  try {
    chmodSync(target, mode);
  } catch {
    // NTFS ACL inheritance owns access on Windows; audit persistence must remain available.
  }
}
