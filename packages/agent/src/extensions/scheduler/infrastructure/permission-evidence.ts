/**
 * @author Codex
 * @description Reads structured permission initialization and terminal evidence through public Pi entries.
 */
import { taskExecutionEvidenceSchema } from '@octopus/shared/protocol/scheduled-tasks';
import type { UnattendedEvidence } from '../../permission-system/definitions/unattended.js';

/**
 * Select the latest exact-session/attempt permission entry without accepting model-authored text.
 */
export function permissionEvidence(
  entries: unknown,
  sessionId: string,
  attemptId: string
): UnattendedEvidence | undefined {
  if (!Array.isArray(entries)) {
    return undefined;
  }
  for (const value of [...(entries as unknown[])].reverse()) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const entry = value as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type === 'custom' && entry.customType === 'octopus-permission-execution') {
      const parsed = taskExecutionEvidenceSchema.safeParse(entry.data);
      if (parsed.success && parsed.data.sessionId === sessionId && parsed.data.attemptId === attemptId) {
        return parsed.data;
      }
    }
  }
  return undefined;
}
