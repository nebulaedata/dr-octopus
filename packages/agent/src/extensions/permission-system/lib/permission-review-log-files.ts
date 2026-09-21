/**
 * @author Codex
 * @description Defines and safely enumerates the managed per-process permission review log files.
 */

import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const REVIEW_LOG_PREFIX = 'permission-review';
const MANAGED_LOG_PATTERN = /^permission-review\.(\d+)-(\d+)-([a-f0-9]{8})\.(\d{3,})\.jsonl$/u;

/**
 * Metadata parsed from one strictly managed permission review filename.
 */
export interface ManagedPermissionReviewLogFile {
  path: string;
  name: string;
  shardId: string;
  processId: number;
  segment: number;
  size: number;
  modifiedAt: number;
}

/**
 * Resolves the directory containing every permission review shard.
 *
 * @param agentDir Pi Agent user directory.
 * @returns Absolute permission review log directory.
 */
export function getPermissionReviewLogDirectory(agentDir: string): string {
  return join(dirname(agentDir), 'permission-system', 'logs');
}

/**
 * Builds one collision-resistant process shard identity.
 *
 * @param processStartedAt Process start epoch milliseconds.
 * @param processId Operating-system process id.
 * @param instanceId Random process instance suffix.
 * @returns Filename-safe shard id.
 */
export function createPermissionReviewShardId(
  processStartedAt: number,
  processId: number,
  instanceId: string
): string {
  return `${String(processStartedAt)}-${String(processId)}-${instanceId}`;
}

/**
 * Builds a stable zero-padded segment filename.
 *
 * @param shardId Process shard identity.
 * @param segment Monotonic shard-local segment number.
 * @returns Managed JSONL filename.
 */
export function createPermissionReviewSegmentFilename(shardId: string, segment: number): string {
  return `${REVIEW_LOG_PREFIX}.${shardId}.${String(segment).padStart(3, '0')}.jsonl`;
}

/**
 * Lists regular permission review segments with strictly managed filenames.
 *
 * @param logsDir Permission review log directory.
 * @returns Safe managed-file metadata.
 */
export function readManagedPermissionReviewLogFiles(logsDir: string): ManagedPermissionReviewLogFile[] {
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const files: ManagedPermissionReviewLogFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = MANAGED_LOG_PATTERN.exec(entry.name);
    if (match === null) {
      continue;
    }
    const processStartedAt = Number.parseInt(match[1] ?? '', 10);
    const processId = Number.parseInt(match[2] ?? '', 10);
    const instanceId = match[3];
    const segment = Number.parseInt(match[4] ?? '', 10);
    if (
      instanceId === undefined ||
      !Number.isSafeInteger(processStartedAt) ||
      !Number.isSafeInteger(processId) ||
      !Number.isSafeInteger(segment)
    ) {
      continue;
    }
    const path = join(logsDir, entry.name);
    let stats;
    try {
      stats = lstatSync(path);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        continue;
      }
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      continue;
    }
    files.push({
      path,
      name: entry.name,
      shardId: createPermissionReviewShardId(processStartedAt, processId, instanceId),
      processId,
      segment,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
    });
  }
  return files;
}

/**
 * Lists managed paths in deterministic filename order for cross-shard queries.
 *
 * @param logsDir Permission review log directory.
 * @returns Absolute managed file paths.
 */
export function listPermissionReviewLogFiles(logsDir: string): string[] {
  return readManagedPermissionReviewLogFiles(logsDir)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((file) => file.path);
}

/**
 * Reads a regular file size without following a pre-created symbolic link.
 *
 * @param path Candidate active segment.
 * @returns Current size or zero when absent.
 */
export function getRegularPermissionReviewLogSize(path: string): number {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Permission review target is not a regular file: ${path}`);
    }
    return stats.size;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return 0;
    }
    throw error;
  }
}

/**
 * Rejects paths outside the owned directory or non-regular existing targets.
 *
 * @param target Candidate segment path.
 * @param logsDir Owned permission log directory.
 */
export function assertManagedPermissionReviewLogPath(target: string, logsDir: string): void {
  if (dirname(resolve(target)) !== resolve(logsDir) || !MANAGED_LOG_PATTERN.test(basename(target))) {
    throw new Error(`Refusing unmanaged permission review path: ${target}`);
  }
  getRegularPermissionReviewLogSize(target);
}

/**
 * Deletes one exact managed regular file without following links.
 *
 * @param target Managed file path.
 * @param logsDir Owned permission log directory.
 */
export function removeManagedPermissionReviewLog(target: string, logsDir: string): void {
  assertManagedPermissionReviewLogPath(target, logsDir);
  try {
    unlinkSync(target);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

/**
 * Recognizes the absent-file condition without masking other IO failures.
 *
 * @param error Candidate filesystem error.
 * @returns Whether the error reports ENOENT.
 */
export function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
