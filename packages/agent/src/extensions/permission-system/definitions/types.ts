/**
 * @author Codex
 * @description Defines host-neutral permission policy configuration and loading results.
 */

import type { PermissionResolvedConfig } from '@octopus/shared/protocol';

export type PermissionToolAction = 'allow' | 'ask' | 'deny';

/**
 * Controls the durable permission review stream independently of enforcement policy.
 */
export interface PermissionAuditConfig {
  permissionReviewLog: boolean;
  reviewLogFieldMaxWidth: number;
}

/**
 * Enumerates the permission request transitions allowed in the durable review stream.
 */
export type PermissionReviewEvent =
  | 'permission_request.allowed'
  | 'permission_request.approved'
  | 'permission_request.auto_approved'
  | 'permission_request.blocked'
  | 'permission_request.denied'
  | 'permission_request.session_approved'
  | 'permission_request.waiting';

/**
 * Filters the durable permission review stream without exposing arbitrary filesystem access.
 */
export interface PermissionReviewQuery {
  limit: number;
  requestId?: string;
  sessionId?: string;
  toolName?: string;
  resolution?: string;
  event?: string;
  since?: string;
}

/**
 * One parsed JSON object from the permission review stream.
 */
export type PermissionReviewEntry = Readonly<Record<string, unknown>>;

/**
 * Reports bounded query results and enough metadata to explain omitted records.
 */
export interface PermissionReviewQueryResult {
  entries: PermissionReviewEntry[];
  matched: number;
  malformedLines: number;
  truncated: boolean;
  logExists: boolean;
}

/**
 * Describes static and auto-mode decisions keyed by exact Pi tool name.
 */
export interface PermissionPolicy {
  tools: Readonly<Record<string, PermissionToolAction>>;
  autoTools: Readonly<Record<string, PermissionToolAction>>;
}

/**
 * Reports one invalid permission configuration source without leaking infrastructure errors.
 */
export interface PermissionPolicyDiagnostic {
  path: string;
  message: string;
}

/**
 * Returns the effective policy together with non-fatal configuration diagnostics.
 */
export interface PermissionPolicyLoadResult {
  configuration: PermissionResolvedConfig;
  policy: PermissionPolicy;
  audit: PermissionAuditConfig;
  diagnostics: PermissionPolicyDiagnostic[];
}
