/**
 * @author Codex
 * @description Defensively projects pi-goal 0.54.3 tool details into stable presentation records.
 */

import { isRecord, readString } from '@/features/session/utils/tool-renderer-utils';
import type { ToolProjection } from '@/stores/session';

export interface GoalToolDetailsProjection {
  goal?: string;
  goalId?: string;
  summary?: string;
  reason?: string;
  evidence?: string;
  repeatedTurns?: number;
  requestedResumeAfterMs?: number;
  resumeAfterMs?: number;
  resumeAt?: number;
}

/**
 * Reads only documented structured fields from the pinned pi-goal result contract.
 *
 * @param tool Browser Tool projection.
 * @returns Safe Goal tool details.
 */
export function projectGoalToolDetails(tool: ToolProjection): GoalToolDetailsProjection {
  const details = isRecord(tool.details) ? tool.details : {};
  return {
    ...(readString(details, 'goal') === undefined ? {} : { goal: readString(details, 'goal') }),
    ...(readString(details, 'goal_id') === undefined ? {} : { goalId: readString(details, 'goal_id') }),
    ...(readString(details, 'summary') === undefined ? {} : { summary: readString(details, 'summary') }),
    ...(readString(details, 'reason') === undefined ? {} : { reason: readString(details, 'reason') }),
    ...(readString(details, 'evidence') === undefined ? {} : { evidence: readString(details, 'evidence') }),
    ...readNonNegativeNumber(details, 'repeated_turns', 'repeatedTurns'),
    ...readNonNegativeNumber(details, 'requested_resume_after_ms', 'requestedResumeAfterMs'),
    ...readNonNegativeNumber(details, 'resume_after_ms', 'resumeAfterMs'),
    ...readNonNegativeNumber(details, 'resume_at', 'resumeAt'),
  };
}

/**
 * Builds a compact collapsed-card label from structured details.
 *
 * @param tool Browser Tool projection.
 * @returns Goal-specific summary when available.
 */
export function summarizeGoalTool(tool: ToolProjection): string | undefined {
  const details = projectGoalToolDetails(tool);
  if (tool.name === 'goal_complete') {
    return details.summary ?? details.goal;
  }
  return details.reason ?? details.goal;
}

/**
 * Copies one finite non-negative numeric field to a presentation property.
 *
 * @param value Source record.
 * @param source Source property name.
 * @param target Presentation property name.
 * @returns Spreadable record when valid.
 */
function readNonNegativeNumber(
  value: Record<string, unknown>,
  source: string,
  target: keyof GoalToolDetailsProjection
): Partial<GoalToolDetailsProjection> {
  const candidate = value[source];
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
    ? { [target]: candidate }
    : {};
}
