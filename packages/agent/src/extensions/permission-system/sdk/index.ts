/**
 * @author Codex
 * @description Exposes the permission service factory used by Agent composition roots.
 */

import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { FilePermissionReviewLogReader } from '../lib/file-permission-review-log-reader.js';
import { FilePermissionReviewLogger } from '../lib/file-permission-review-logger.js';
import { FilePermissionPolicyRepository } from '../lib/file-permission-policy-repository.js';
import { PermissionModeService } from '../services/permission-mode-service.js';

/**
 * Overrides filesystem locations when embedding the permission service in tests or another host.
 */
export interface CreatePermissionModeServiceOptions {
  agentDir?: string;
  configDirName?: string;
  cwd?: string;
}

/**
 * Creates an isolated runtime-generation permission service.
 *
 * @returns Fresh service defaulting to ask mode.
 */
export function createPermissionModeService(
  options: CreatePermissionModeServiceOptions = {}
): PermissionModeService {
  const agentDir = options.agentDir ?? getAgentDir();
  const repository = new FilePermissionPolicyRepository(agentDir, options.configDirName);
  const reviewLog = new FilePermissionReviewLogger(agentDir);
  const reviewLogReader = new FilePermissionReviewLogReader(agentDir);
  const cwd = options.cwd ?? process.cwd();
  const initial = repository.load(cwd, false);
  return new PermissionModeService(
    repository,
    reviewLog,
    reviewLogReader,
    initial.policy,
    initial.audit,
    initial.configuration
  );
}

export type {
  PermissionDecision,
  PermissionDecisionSource,
  PermissionEvaluation,
  PermissionRequest,
} from '../services/permission-mode-service.js';
export type {
  PermissionAuditConfig,
  PermissionPolicy,
  PermissionPolicyDiagnostic,
  PermissionReviewEvent,
  PermissionReviewEntry,
  PermissionReviewQuery,
  PermissionReviewQueryResult,
  PermissionToolAction,
} from '../definitions/types.js';
export { getPermissionReviewLogDirectory } from '../lib/permission-review-log-files.js';
export { openGrantRepository } from '../lib/grant-repository.js';
export { requirePermissionGrant } from '../services/grant-validation.js';
export { PermissionGrantError } from '../definitions/grant.js';
export type { GrantRepository, GrantBinding } from '../definitions/grant.js';
export { PermissionModeService } from '../services/permission-mode-service.js';
export { PermissionConfigurationStore } from '../lib/configuration-store.js';
export { PermissionConfigurationError } from '../lib/configuration-files.js';

export { createUnattendedToolCatalog } from '../lib/tool-catalog.js';

export { captureDelegatedPermissions, evaluateDelegatedPermission } from './delegation.js';
export type { DelegatedPermissionSnapshot } from './delegation.js';
