/**
 * @author Codex
 * @description Defines durable subject grants independently of scheduling and Pi transports.
 */
import type { TaskToolCapability } from '@octopus/shared/protocol/scheduled-tasks';

export interface GrantBinding {
  profileId: string;
  subjectId: string;
  workspaceId: string;
  executionDigest: string;
}
export interface PermissionGrant extends GrantBinding {
  id: string;
  schemaVersion: number;
  revision: number;
  state: 'active' | 'revoked';
  tools: TaskToolCapability[];
  operationId: string;
  approvedAt: string;
}
export interface GrantRepository {
  /**
   * Read the latest committed grant without retaining a snapshot across calls.
   */
  get(id: string): PermissionGrant | undefined;
  /**
   * Commit an idempotent explicit user approval with its durable audit record.
   */
  approve(binding: GrantBinding, tools: TaskToolCapability[], operationId: string): PermissionGrant;
  /**
   * Revoke one exact grant revision; repeated revocation is harmless.
   */
  revoke(id: string, revision: number): void;
  /**
   * Release the owned connection.
   */
  close(): void;
}

/**
 * Keep stable grant failures distinct from underlying storage exceptions.
 */
export class PermissionGrantError extends Error {
  /**
   * Construct a safe cross-boundary reason without exposing database diagnostics.
   */
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}
