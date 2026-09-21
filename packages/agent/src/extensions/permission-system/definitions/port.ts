/**
 * @author Codex
 * @description Defines the configuration repository boundary used by the permission service.
 */

import type {
  PermissionPolicyLoadResult,
  PermissionReviewEvent,
  PermissionReviewQuery,
  PermissionReviewQueryResult,
} from './types.js';

/**
 * Loads permission policy for one active Pi workspace.
 */
export interface PermissionPolicyRepository {
  /**
   * Loads global policy and, only for trusted workspaces, the project overlay.
   *
   * @param cwd Active Pi workspace directory.
   * @param projectTrusted Whether Pi has granted project configuration trust.
   * @returns Effective policy and safe diagnostics.
   */
  load(cwd: string, projectTrusted: boolean): PermissionPolicyLoadResult;
}

/**
 * Appends bounded structured events to the durable permission review stream.
 */
export interface PermissionReviewLogger {
  /**
   * Writes one JSONL review entry without allowing audit IO failure to break the permission gate.
   *
   * @param event Stable review event name.
   * @param details Structured request and decision facts.
   * @param maxFieldWidth Maximum characters retained for every nested string value.
   * @returns A deduplicated warning when the write failed, otherwise undefined.
   */
  write(
    event: PermissionReviewEvent,
    details: Readonly<Record<string, unknown>>,
    maxFieldWidth: number
  ): string | undefined;
}

/**
 * Reads the append-only review stream through a bounded structured query contract.
 */
export interface PermissionReviewLogReader {
  /**
   * Returns the newest matching entries without granting arbitrary path access.
   *
   * @param query Validated filters and result limit.
   * @param signal Optional cancellation signal from the invoking Pi tool.
   * @returns Structured matches in chronological order.
   */
  query(query: PermissionReviewQuery, signal?: AbortSignal): Promise<PermissionReviewQueryResult>;
}
