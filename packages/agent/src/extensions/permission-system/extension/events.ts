/**
 * @author Codex
 * @description Adapts Pi tool and shell events to the Octopus permission policy and confirmation UI.
 */

import { requestPermissionDecision } from './permission-dialog.js';
import {
  createPermissionRequestId,
  recordAllowedPermission,
  recordBlockedPermission,
  recordGateError,
  recordPromptDecision,
  recordUnavailablePermission,
  recordWaitingPermission,
} from './permission-audit.js';
import {
  getToolCommand,
  normalizeToolPermission,
  normalizeUserBashPermission,
} from './permission-request.js';
import type { UnattendedGate } from './unattended.js';
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import type { PermissionAuditContext } from './permission-audit.js';
import type { PermissionModeService, PermissionRequest } from '../services/permission-mode-service.js';

interface AuthorizationResult {
  allowed: boolean;
  denialReason?: string;
}

/**
 * Registers fail-closed permission gates before Pi executes tools or direct shell commands.
 *
 * @param pi Pi extension registration surface.
 * @param service Shared runtime-generation permission service.
 */
export function registerPermissionEvents(
  pi: ExtensionAPI,
  service: PermissionModeService,
  unattended?: UnattendedGate
): void {
  pi.on('session_start', (_event, ctx) => {
    const result = service.reloadPolicy(ctx.cwd, ctx.isProjectTrusted());
    for (const diagnostic of result.diagnostics) {
      process.stderr.write(`权限配置无效 (${diagnostic.path}): ${diagnostic.message}\n`);
    }
  });
  pi.on('tool_call', async (event, ctx) => {
    try {
      service.reloadPolicy(ctx.cwd, ctx.isProjectTrusted());
      if (unattended) {
        const request = normalizeToolPermission(event, ctx.cwd, service.getConfiguration()).request;
        try {
          unattended.check(request, ctx, event.input);
          service.writeReviewLog('permission_request.allowed', {
            sessionId: ctx.sessionManager.getSessionId(),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            decisionSource: 'durable_grant',
            decidedBy: { kind: 'system' },
          });
          return {};
        } catch (error) {
          void ctx.abort();
          return { block: true, reason: getErrorMessage(error) };
        }
      }
      const decision = await authorizeToolCall(service, event, ctx);
      if (decision.block || event.toolName !== 'background_task' || event.input['action'] !== 'start') {
        return decision;
      }
      // Preserve explicit background_task policy and also require the exact bash command authorization.
      return await authorizeToolCall(service, { ...event, toolName: 'bash' }, ctx);
    } catch (error) {
      return blockToolCallOnGateError(service, event, ctx, error);
    }
  });
  pi.on('session_shutdown', () => {
    service.clearSessionApprovals();
  });
  pi.on('user_bash', async (event, ctx) => {
    try {
      service.reloadPolicy(ctx.cwd, ctx.isProjectTrusted());
      if (unattended) {
        unattended.check(
          normalizeUserBashPermission(event.command, ctx.cwd, service.getConfiguration()).request,
          ctx
        );
      }
      return await authorizeUserBash(service, event.command, ctx);
    } catch (error) {
      const reason = getErrorMessage(error);
      recordGateError(service, ctx, {
        source: 'user_bash',
        toolName: 'user_bash',
        command: event.command,
        input: { command: event.command },
        reason,
      });
      return {
        result: {
          output: formatBlockedReason(reason),
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }
  });
}

/**
 * Applies the permission gate to one direct user shell command.
 *
 * @param service Permission policy and audit owner.
 * @param command User-entered shell command.
 * @param ctx Current extension context.
 * @returns Pi user-bash continuation or blocked-result contract.
 */
async function authorizeUserBash(service: PermissionModeService, command: string, ctx: ExtensionContext) {
  const normalized = normalizeUserBashPermission(command, ctx.cwd, service.getConfiguration());
  const authorization = await authorize(
    service,
    normalized.request,
    ctx,
    normalized.detail,
    normalized.sessionLabel,
    {
      requestId: createPermissionRequestId(),
      source: 'user_bash',
      command,
      input: { command },
    }
  );
  if (authorization.allowed) {
    return {};
  }
  return {
    result: {
      output: formatBlockedReason(authorization.denialReason),
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  };
}

/**
 * Normalizes a Pi tool event and returns the blocking contract expected by Pi.
 *
 * @param service Permission policy owner.
 * @param event Pi tool call event.
 * @param ctx Current extension context.
 * @returns Empty result when allowed or an explicit block result.
 */
async function authorizeToolCall(
  service: PermissionModeService,
  event: ToolCallEvent,
  ctx: ExtensionContext
): Promise<ToolCallEventResult> {
  const normalized = normalizeToolPermission(event, ctx.cwd, service.getConfiguration());
  const authorization = await authorize(
    service,
    normalized.request,
    ctx,
    normalized.detail,
    normalized.sessionLabel,
    {
      requestId: createPermissionRequestId(),
      source: 'tool_call',
      toolCallId: event.toolCallId,
      target: normalized.target,
      command: normalized.command,
      input: event.input,
    }
  );
  return authorization.allowed
    ? {}
    : { block: true, reason: formatBlockedReason(authorization.denialReason) };
}

/**
 * Applies policy and, when required, asks through Pi's RPC/TUI-capable UI surface.
 *
 * @param service Permission policy owner.
 * @param request Normalized request.
 * @param ctx Current extension context.
 * @param detail Human-readable operation detail.
 * @param sessionLabel Human-readable scope offered for the in-memory session approval.
 * @param auditContext Stable request identity and bounded loggable input facts.
 * @returns Authorization outcome and an optional user-provided denial reason.
 */
async function authorize(
  service: PermissionModeService,
  request: PermissionRequest,
  ctx: ExtensionContext,
  detail: string,
  sessionLabel: string | undefined,
  auditContext: PermissionAuditContext
): Promise<AuthorizationResult> {
  const evaluation = service.evaluate(request);
  if (evaluation.decision === 'allow') {
    recordAllowedPermission(service, request, ctx, auditContext, evaluation);
    return { allowed: true };
  }
  if (evaluation.decision === 'deny') {
    recordBlockedPermission(service, request, ctx, auditContext, evaluation);
    return { allowed: false };
  }
  recordWaitingPermission(service, request, ctx, auditContext, evaluation);
  if (!ctx.hasUI) {
    recordUnavailablePermission(service, request, ctx, auditContext, evaluation);
    return { allowed: false };
  }
  const beforePrompt = JSON.stringify([service.getConfiguration(), service.getState().mode]);
  const promptDecision = await requestPermissionDecision(
    ctx.ui,
    'Permission Required',
    detail,
    sessionLabel ?? null
  );
  const refreshed = service.reloadPolicy(ctx.cwd, ctx.isProjectTrusted());
  if (
    promptDecision.approved &&
    (refreshed.diagnostics.length > 0 ||
      beforePrompt !== JSON.stringify([service.getConfiguration(), service.getState().mode]))
  ) {
    recordBlockedPermission(service, request, ctx, auditContext, {
      decision: 'deny',
      source: 'configuration',
    });
    return {
      allowed: false,
      denialReason: 'Permission configuration changed while awaiting approval. Retry the operation.',
    };
  }
  if (promptDecision.state === 'approved_for_session' && request.sessionApprovalKey !== undefined) {
    service.recordSessionApproval(request.sessionApprovalKey);
  }
  recordPromptDecision(service, request, ctx, auditContext, evaluation, promptDecision);
  return {
    allowed: promptDecision.approved,
    denialReason: promptDecision.state === 'denied_with_reason' ? promptDecision.denialReason : undefined,
  };
}

/**
 * Converts an unexpected tool-gate exception into a durable gate-error record and hard block.
 *
 * @param service Permission policy and audit owner.
 * @param event Pi tool call event.
 * @param ctx Current extension context.
 * @param error Unexpected gate failure.
 * @returns Explicit Pi block result.
 */
function blockToolCallOnGateError(
  service: PermissionModeService,
  event: ToolCallEvent,
  ctx: ExtensionContext,
  error: unknown
): ToolCallEventResult {
  const reason = getErrorMessage(error);
  recordGateError(service, ctx, {
    source: 'tool_call',
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    command: getToolCommand(event.input),
    input: event.input,
    reason,
  });
  return { block: true, reason: formatBlockedReason(reason) };
}

/**
 * Normalizes an unknown exception into a bounded audit and denial reason.
 *
 * @param error Unexpected gate failure.
 * @returns Human-readable error message.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Preserves a user's denial explanation in the tool result seen by the agent.
 *
 * @param denialReason Optional explanation entered in the permission dialog.
 * @returns Stable block reason with the explanation appended when present.
 */
function formatBlockedReason(denialReason?: string): string {
  return denialReason
    ? `Blocked by the Octopus permission policy: ${denialReason}`
    : 'Blocked by the Octopus permission policy.';
}
