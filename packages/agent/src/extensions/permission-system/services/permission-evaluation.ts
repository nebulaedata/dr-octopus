/**
 * @author Codex
 * @description Evaluates normalized permission requests identically for interactive and delegated sessions.
 */
import type { PermissionMode, PermissionResolvedConfig } from '@octopus/shared/protocol';
import type { PermissionPolicy } from '../definitions/types.js';
import type {
  PermissionDecisionSource,
  PermissionEvaluation,
  PermissionRequest,
} from './permission-mode-service.js';

/**
 * Preserve deny precedence and argument safety; callers explicitly own ephemeral approvals.
 */
export function evaluatePermissionRequest(
  request: PermissionRequest,
  configuration: PermissionResolvedConfig,
  policy: PermissionPolicy,
  permissionMode: PermissionMode,
  sessionApproved = false,
  configurationInvalid = false
): PermissionEvaluation {
  if (request.sensitive || configurationInvalid) {
    return { decision: 'deny', source: 'hard_safety' };
  }
  const mode = configuration.modes[permissionMode];
  const staticAction = policy.tools[request.toolName];
  const modeAction = mode.tools[request.toolName];
  // Denies always precede grants, including previously approved session scopes.
  if (staticAction === 'deny' || modeAction === 'deny') {
    return { decision: 'deny', source: 'static_policy' };
  }
  if (request.external && mode.external === 'deny') {
    return { decision: 'deny', source: 'configuration' };
  }
  const toolAction = staticAction ?? modeAction ?? mode.kinds[request.kind];
  if (toolAction === 'deny') {
    return { decision: 'deny', source: 'configuration' };
  }
  const action = request.external && mode.external === 'ask' ? 'ask' : toolAction;
  if (request.sessionApprovalKey !== undefined && sessionApproved) {
    return { decision: 'allow', source: 'session_approval' };
  }
  const source: PermissionDecisionSource =
    staticAction !== undefined && !request.external
      ? 'static_policy'
      : permissionMode === 'full'
        ? 'full_mode'
        : modeAction !== undefined && permissionMode === 'auto' && !request.external
          ? 'auto_tool'
          : request.kind === 'read' && action === 'allow' && !request.external
            ? 'read_default'
            : permissionMode === 'auto' && request.kind === 'write' && action === 'allow' && !request.external
              ? 'auto_write'
              : action === 'ask'
                ? 'default_ask'
                : 'configuration';
  return { decision: action, source };
}
