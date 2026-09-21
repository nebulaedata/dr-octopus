/**
 * @author Codex
 * @description Defines transport-neutral unattended context and initialization evidence.
 */
import type { TaskAuthorizationRef, TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';
import type { GrantBinding } from './grant.js';

export const UNATTENDED_EVIDENCE = 'octopus-permission-execution';
export interface UnattendedDescriptor extends GrantBinding {
  sessionId: string;
  attemptId: string;
  cwd: string;
  ref: TaskAuthorizationRef | null;
  inspect: boolean;
}
export interface UnattendedEvidence {
  sessionId: string;
  attemptId: string;
  ready: boolean;
  tools: TaskToolCatalogEntry[];
  code?: string;
  reason?: string;
  requestId?: string;
  toolName?: string;
}
