/**
 * @author Codex
 * @description Captures parent permission configuration and evaluates delegated calls without transferring approvals.
 */
import { isAbsolute, resolve } from 'node:path';
import { normalizePermissionRequest } from '../services/permission-request.js';
import { evaluatePermissionRequest } from '../services/permission-evaluation.js';
import type { PermissionMode, PermissionResolvedConfig } from '@octopus/shared/protocol';
import type { PermissionModeService } from '../services/permission-mode-service.js';

export interface DelegatedPermissionSnapshot {
  version: 2;
  cwd: string;
  mode: PermissionMode;
  configuration: PermissionResolvedConfig;
}

/**
 * Reload trusted parent policy before delegation; invalid configuration never produces authority.
 */
export function captureDelegatedPermissions(
  service: PermissionModeService,
  cwd: string,
  projectTrusted: boolean
): DelegatedPermissionSnapshot {
  if (service.reloadPolicy(cwd, projectTrusted).diagnostics.length) {
    throw new Error('CHILD_PERMISSION_CONFIG_INVALID: 父会话权限配置无效');
  }
  return {
    version: 2,
    cwd: resolve(cwd),
    mode: service.getState().mode,
    configuration: service.getConfiguration(),
  };
}

/**
 * Resolve arguments in the child cwd while retaining the parent workspace authorization boundary.
 */
export function evaluateDelegatedPermission(
  snapshot: DelegatedPermissionSnapshot,
  toolName: string,
  input: Record<string, unknown>,
  cwd: string
) {
  if (
    !snapshot ||
    snapshot.version !== 2 ||
    typeof snapshot.cwd !== 'string' ||
    !isAbsolute(snapshot.cwd) ||
    !['ask', 'auto', 'full'].includes(snapshot.mode)
  ) {
    throw new Error('CHILD_PERMISSION_SNAPSHOT_INVALID: 请重新委派子代理');
  }
  const configuration = snapshot.configuration;
  const { request } = normalizePermissionRequest(toolName, input, cwd, configuration, snapshot.cwd);
  return evaluatePermissionRequest(
    request,
    configuration,
    { tools: configuration.policy.tools, autoTools: configuration.modes.auto.tools },
    snapshot.mode
  );
}
