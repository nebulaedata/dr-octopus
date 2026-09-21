/**
 * @author Codex
 * @description Projects permission gate requests and outcomes into the durable structured review-log contract.
 */

import { randomUUID } from 'node:crypto';
import { serializeRedactedToolInputPreview } from '../lib/file-permission-review-logger.js';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { PermissionPromptDecision } from './permission-dialog.js';
import type {
  PermissionEvaluation,
  PermissionModeService,
  PermissionRequest,
} from '../services/permission-mode-service.js';
import type { PermissionReviewEvent } from '../definitions/types.js';

/**
 * Carries stable request identity and raw input across one permission decision flow.
 */
export interface PermissionAuditContext {
  requestId: string;
  source: 'tool_call' | 'user_bash';
  toolCallId?: string;
  target?: string;
  command?: string;
  input: Record<string, unknown>;
}

/**
 * Creates a self-identifying request id suitable for correlating JSONL entries.
 *
 * @returns Unique permission request id.
 */
export function createPermissionRequestId(): string {
  return `perm-${randomUUID()}`;
}

/**
 * Records an allow, auto-approval, or session-approval decision.
 *
 * @param service Permission policy and audit owner.
 * @param request Normalized permission request.
 * @param ctx Current extension context.
 * @param auditContext Stable request identity and raw input.
 * @param evaluation Initial gate decision and provenance.
 */
export function recordAllowedPermission(
  service: PermissionModeService,
  request: PermissionRequest,
  ctx: ExtensionContext,
  auditContext: PermissionAuditContext,
  evaluation: PermissionEvaluation
): void {
  const sessionApproved = evaluation.source === 'session_approval';
  const autoApproved = evaluation.source === 'auto_tool' || evaluation.source === 'auto_write';
  writeReviewLog(
    service,
    ctx,
    sessionApproved
      ? 'permission_request.session_approved'
      : autoApproved
        ? 'permission_request.auto_approved'
        : 'permission_request.allowed',
    {
      ...createAuditDetails(service, request, ctx, auditContext, evaluation),
      resolution: sessionApproved
        ? 'session_approved'
        : autoApproved
          ? 'auto_approved'
          : evaluation.source === 'full_mode'
            ? 'full_access'
            : 'policy_allowed',
      decidedBy: { kind: evaluation.source },
    }
  );
}

/**
 * Records a hard-safety or configured-policy denial.
 *
 * @param service Permission policy and audit owner.
 * @param request Normalized permission request.
 * @param ctx Current extension context.
 * @param auditContext Stable request identity and raw input.
 * @param evaluation Initial gate decision and provenance.
 */
export function recordBlockedPermission(
  service: PermissionModeService,
  request: PermissionRequest,
  ctx: ExtensionContext,
  auditContext: PermissionAuditContext,
  evaluation: PermissionEvaluation
): void {
  writeReviewLog(service, ctx, 'permission_request.blocked', {
    ...createAuditDetails(service, request, ctx, auditContext, evaluation),
    resolution: evaluation.source === 'hard_safety' ? 'hard_safety_denied' : 'policy_denied',
    decidedBy: { kind: evaluation.source },
  });
}

/**
 * Opens an auditable bracket before interactive confirmation begins.
 *
 * @param service Permission policy and audit owner.
 * @param request Normalized permission request.
 * @param ctx Current extension context.
 * @param auditContext Stable request identity and raw input.
 * @param evaluation Ask decision and provenance.
 */
export function recordWaitingPermission(
  service: PermissionModeService,
  request: PermissionRequest,
  ctx: ExtensionContext,
  auditContext: PermissionAuditContext,
  evaluation: PermissionEvaluation
): void {
  writeReviewLog(service, ctx, 'permission_request.waiting', {
    ...createAuditDetails(service, request, ctx, auditContext, evaluation),
    resolution: null,
  });
}

/**
 * Closes an ask bracket when no interactive authority is available.
 *
 * @param service Permission policy and audit owner.
 * @param request Normalized permission request.
 * @param ctx Current extension context.
 * @param auditContext Stable request identity and raw input.
 * @param evaluation Ask decision and provenance.
 */
export function recordUnavailablePermission(
  service: PermissionModeService,
  request: PermissionRequest,
  ctx: ExtensionContext,
  auditContext: PermissionAuditContext,
  evaluation: PermissionEvaluation
): void {
  writeReviewLog(service, ctx, 'permission_request.denied', {
    ...createAuditDetails(service, request, ctx, auditContext, evaluation),
    resolution: 'confirmation_unavailable',
    denialReason: null,
    decidedBy: { kind: 'unavailable' },
  });
}

/**
 * Closes an ask bracket with the user's final approval or denial.
 *
 * @param service Permission policy and audit owner.
 * @param request Normalized permission request.
 * @param ctx Current extension context.
 * @param auditContext Stable request identity and raw input.
 * @param evaluation Ask decision and provenance.
 * @param decision User prompt outcome.
 */
export function recordPromptDecision(
  service: PermissionModeService,
  request: PermissionRequest,
  ctx: ExtensionContext,
  auditContext: PermissionAuditContext,
  evaluation: PermissionEvaluation,
  decision: PermissionPromptDecision
): void {
  writeReviewLog(
    service,
    ctx,
    decision.approved ? 'permission_request.approved' : 'permission_request.denied',
    {
      ...createAuditDetails(service, request, ctx, auditContext, evaluation),
      resolution: decision.state,
      denialReason: decision.state === 'denied_with_reason' ? decision.denialReason : null,
      decidedBy: { kind: 'user' },
    }
  );
}

/**
 * Writes the upstream-compatible fail-closed record without letting logging failure reopen the gate.
 *
 * @param service Permission policy and audit owner.
 * @param ctx Current extension context.
 * @param details Best-effort request facts and error reason.
 */
export function recordGateError(
  service: PermissionModeService,
  ctx: ExtensionContext,
  details: {
    source: 'tool_call' | 'user_bash';
    toolCallId?: string;
    toolName: string;
    command?: string;
    input: Record<string, unknown>;
    reason: string;
  }
): void {
  writeReviewLog(service, ctx, 'permission_request.blocked', {
    requestId: createPermissionRequestId(),
    source: details.source,
    sessionId: getSessionId(ctx),
    mode: service.getState().mode,
    toolCallId: details.toolCallId ?? null,
    toolName: details.toolName,
    command: details.command ?? null,
    toolInputPreview: serializeRedactedToolInputPreview(details.input),
    resolution: 'gate_error',
    error: details.reason,
    decidedBy: { kind: 'gate_error', reason: details.reason },
  });
}

/**
 * Builds the shared structured columns written for every outcome of one request.
 *
 * @param service Permission state owner.
 * @param request Normalized permission request.
 * @param ctx Current extension context.
 * @param auditContext Request identity and raw input.
 * @param evaluation Initial gate decision and provenance.
 * @returns Stable review-log context.
 */
function createAuditDetails(
  service: PermissionModeService,
  request: PermissionRequest,
  ctx: ExtensionContext,
  auditContext: PermissionAuditContext,
  evaluation: PermissionEvaluation
): Record<string, unknown> {
  return {
    requestId: auditContext.requestId,
    source: auditContext.source,
    sessionId: getSessionId(ctx),
    mode: service.getState().mode,
    toolCallId: auditContext.toolCallId ?? null,
    toolName: request.toolName,
    kind: request.kind,
    external: request.external,
    sensitive: request.sensitive,
    path: auditContext.target ?? null,
    command: auditContext.command ?? null,
    toolInputPreview: serializeRedactedToolInputPreview(auditContext.input),
    policyDecision: evaluation.decision,
    policySource: evaluation.source,
  };
}

/**
 * Sends one audit persistence warning to the active UI or process diagnostics.
 *
 * @param service Permission audit owner.
 * @param ctx Current extension context.
 * @param event Stable review event name.
 * @param details Structured review details.
 */
function writeReviewLog(
  service: PermissionModeService,
  ctx: ExtensionContext,
  event: PermissionReviewEvent,
  details: Readonly<Record<string, unknown>>
): void {
  const warning = service.writeReviewLog(event, details);
  if (warning === undefined) {
    return;
  }
  try {
    if (ctx.hasUI) {
      ctx.ui.notify(warning, 'warning');
    } else {
      process.stderr.write(`${warning}\n`);
    }
  } catch {
    process.stderr.write(`${warning}\n`);
  }
}

/**
 * Reads the current session id without allowing diagnostic metadata failure to affect enforcement.
 *
 * @param ctx Current extension context.
 * @returns Active Pi session id or null when unavailable.
 */
function getSessionId(ctx: ExtensionContext): string | null {
  try {
    return ctx.sessionManager?.getSessionId() ?? null;
  } catch {
    return null;
  }
}
