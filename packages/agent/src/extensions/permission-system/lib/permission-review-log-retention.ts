/**
 * @author Codex
 * @description Prunes closed or dead-process permission review segments within fixed history bounds.
 */

import {
  readManagedPermissionReviewLogFiles,
  removeManagedPermissionReviewLog,
} from './permission-review-log-files.js';

/**
 * Defines the globally retained closed-segment budget.
 */
export interface PermissionReviewLogRetentionOptions {
  maxHistoryFiles: number;
  maxHistoryBytes: number;
  currentShardId: string;
  isProcessAlive: (processId: number) => boolean;
}

/**
 * Removes the oldest closed segments while preserving one active segment per live process.
 *
 * @param logsDir Permission review directory.
 * @param options Retention bounds and current process identity.
 */
export function prunePermissionReviewLogHistory(
  logsDir: string,
  options: PermissionReviewLogRetentionOptions
): void {
  const files = readManagedPermissionReviewLogFiles(logsDir);
  const latestSegmentByShard = new Map<string, number>();
  for (const file of files) {
    latestSegmentByShard.set(
      file.shardId,
      Math.max(latestSegmentByShard.get(file.shardId) ?? -1, file.segment)
    );
  }

  const liveShardIds = new Set<string>([options.currentShardId]);
  for (const file of files) {
    if (options.isProcessAlive(file.processId)) {
      liveShardIds.add(file.shardId);
    }
  }

  const candidates = files
    .filter(
      (file) => !(liveShardIds.has(file.shardId) && file.segment === latestSegmentByShard.get(file.shardId))
    )
    .sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));

  let retainedFiles = 0;
  let retainedBytes = 0;
  for (const file of candidates) {
    if (retainedFiles < options.maxHistoryFiles && retainedBytes + file.size <= options.maxHistoryBytes) {
      retainedFiles += 1;
      retainedBytes += file.size;
      continue;
    }
    removeManagedPermissionReviewLog(file.path, logsDir);
  }
}
