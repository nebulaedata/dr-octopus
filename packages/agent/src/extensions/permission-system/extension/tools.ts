/**
 * @author Codex
 * @description Registers the bounded read-only model tool for querying permission audit history.
 */

import { Type } from 'typebox';
import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PermissionReviewEntry, PermissionReviewQuery } from '../definitions/types.js';
import type { PermissionModeService } from '../services/permission-mode-service.js';

const DEFAULT_QUERY_LIMIT = 20;

interface PermissionAuditQueryToolDetails {
  query: PermissionReviewQuery;
  entries: PermissionReviewEntry[];
  matched: number;
  malformedLines: number;
  truncated: boolean;
  logExists: boolean;
}

/**
 * Registers the agent-visible permission audit query contract.
 *
 * @param pi Pi extension registration surface.
 * @param service Host-neutral permission audit service.
 */
export function registerPermissionTools(pi: ExtensionAPI, service: PermissionModeService): void {
  pi.registerTool({
    name: 'permission_audit_query',
    label: 'Permission Audit Query',
    description:
      'Read the newest structured Octopus permission audit events. This tool is read-only, accepts exact request/session/tool/resolution/event filters plus an inclusive since timestamp, returns chronological JSON entries, and never accepts a filesystem path. Use it whenever permission history, approval provenance, denials, or authorization diagnostics are needed.',
    parameters: Type.Object(
      {
        limit: Type.Optional(
          Type.Integer({
            description: 'Maximum newest matching entries to return. Defaults to 20; maximum 100.',
            minimum: 1,
            maximum: 100,
          })
        ),
        requestId: Type.Optional(Type.String({ description: 'Exact permission request identifier.' })),
        sessionId: Type.Optional(Type.String({ description: 'Exact Pi session identifier.' })),
        toolName: Type.Optional(Type.String({ description: 'Exact invoked tool name.' })),
        resolution: Type.Optional(
          Type.String({ description: 'Exact audit resolution, such as approved, denied, or auto_approved.' })
        ),
        event: Type.Optional(
          Type.String({ description: 'Exact audit event name, such as permission_request.blocked.' })
        ),
        since: Type.Optional(
          Type.String({ description: 'Inclusive ISO-8601 timestamp lower bound.' })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<PermissionAuditQueryToolDetails>> {
      const query: PermissionReviewQuery = {
        limit: params.limit ?? DEFAULT_QUERY_LIMIT,
        requestId: normalizeOptionalFilter(params.requestId),
        sessionId: normalizeOptionalFilter(params.sessionId),
        toolName: normalizeOptionalFilter(params.toolName),
        resolution: normalizeOptionalFilter(params.resolution),
        event: normalizeOptionalFilter(params.event),
        since: normalizeOptionalFilter(params.since),
      };

      const result = await service.queryReviewLog(query, signal);
      const summary = result.logExists
        ? `Returned ${result.entries.length} of ${result.matched} matching permission audit events${
            result.truncated ? ' (newest entries only)' : ''
          }. Malformed lines skipped: ${result.malformedLines}.`
        : 'No permission audit log exists yet.';
      return {
        content: [
          {
            type: 'text',
            text: `${summary}\n${JSON.stringify(result.entries, null, 2)}`,
          },
        ],
        details: { query, ...result },
      };
    },
  });
}

/**
 * Converts blank optional filters into omission so exact matching remains predictable.
 *
 * @param value Optional model-provided string.
 * @returns Trimmed filter or undefined.
 */
function normalizeOptionalFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
