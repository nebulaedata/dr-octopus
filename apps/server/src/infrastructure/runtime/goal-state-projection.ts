/**
 * @author Codex
 * @description Validates pi-goal 0.54.3 Session entries and projects the active branch state into a bounded Host DTO.
 */

import type { GoalStateDto, GoalStatus, GoalWaitDto } from '@octopus/shared/protocol';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

const GOAL_STATE_ENTRY_TYPE = 'goal-state';
const MAX_OBJECTIVE_CHARACTERS = 4_000;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_WAIT_REASON_CHARACTERS = 1_000;
const GOAL_STATUSES = new Set<GoalStatus>(['active', 'paused', 'blocked', 'usage_limited', 'budget_limited']);

/**
 * Projects the latest canonical pi-goal entry from the current Session branch.
 *
 * @param entries Current branch entries returned by Pi SessionManager.
 * @returns A bounded Goal state, or undefined when no visible Goal is active or the entry is invalid.
 */
export function projectGoalState(entries: readonly SessionEntry[]): GoalStateDto | undefined {
  let entry: SessionEntry | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index];
    if (candidate?.type === 'custom' && candidate.customType === GOAL_STATE_ENTRY_TYPE) {
      entry = candidate;
      break;
    }
  }
  if (entry?.type !== 'custom' || !isRecord(entry.data) || entry.data['goal'] === null) {
    return undefined;
  }
  return parseGoal(entry.data['goal']);
}

/**
 * Validates one upstream Goal record while omitting internal accounting and stale-turn fields.
 *
 * @param value Candidate Goal record.
 * @returns Browser-safe Goal state when every required invariant is valid.
 */
function parseGoal(value: unknown): GoalStateDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readBoundedString(value['id'], MAX_IDENTIFIER_CHARACTERS);
  const objective = readBoundedString(value['text'], MAX_OBJECTIVE_CHARACTERS);
  const status = value['status'];
  if (
    id === undefined ||
    objective === undefined ||
    typeof status !== 'string' ||
    !GOAL_STATUSES.has(status as GoalStatus)
  ) {
    return undefined;
  }
  const startedAt = readNonNegativeNumber(value['startedAt']);
  const updatedAt = readNonNegativeNumber(value['updatedAt']);
  const iteration = readNonNegativeInteger(value['iteration']);
  const tokensUsed = readNonNegativeNumber(value['tokensUsed']);
  const timeUsedSeconds = readNonNegativeNumber(value['timeUsedSeconds']);
  const automaticModelTurns = readNonNegativeInteger(value['automaticModelTurns'] ?? 0);
  if (
    startedAt === undefined ||
    updatedAt === undefined ||
    iteration === undefined ||
    tokensUsed === undefined ||
    timeUsedSeconds === undefined ||
    automaticModelTurns === undefined
  ) {
    return undefined;
  }
  const tokenBudget = readOptionalPositiveInteger(value['tokenBudget']);
  if (tokenBudget === null) {
    return undefined;
  }
  const waiting = value['waiting'] === undefined ? undefined : parseWaiting(value['waiting']);
  if (value['waiting'] !== undefined && waiting === undefined) {
    return undefined;
  }
  const safetyPauseCause = value['safetyPauseCause'];
  if (
    safetyPauseCause !== undefined &&
    safetyPauseCause !== 'continuation_limit' &&
    safetyPauseCause !== 'no_progress'
  ) {
    return undefined;
  }
  return {
    id,
    objective,
    status: status as GoalStatus,
    startedAt,
    updatedAt,
    iteration,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    tokensUsed,
    timeUsedSeconds,
    automaticModelTurns,
    ...(safetyPauseCause === undefined ? {} : { safetyPauseCause }),
    ...(waiting === undefined ? {} : { waiting }),
  };
}

/**
 * Validates the public portion of pi-goal's optional wait state.
 *
 * @param value Candidate wait record.
 * @returns Safe wait metadata when valid.
 */
function parseWaiting(value: unknown): GoalWaitDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const reason = readBoundedString(value['reason'], MAX_WAIT_REASON_CHARACTERS);
  const resumeAt = readOptionalNonNegativeNumber(value['resumeAt']);
  if (reason === undefined || resumeAt === null) {
    return undefined;
  }
  return { reason, ...(resumeAt === undefined ? {} : { resumeAt }) };
}

/**
 * Narrows an unknown value to a non-array record.
 *
 * @param value Candidate value.
 * @returns Whether named properties may be read safely.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a non-empty bounded string.
 *
 * @param value Candidate string.
 * @param maximum Maximum accepted character count.
 * @returns Valid string or undefined.
 */
function readBoundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : undefined;
}

/**
 * Reads a finite non-negative number.
 *
 * @param value Candidate numeric value.
 * @returns Valid number or undefined.
 */
function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Reads a safe non-negative integer.
 *
 * @param value Candidate count.
 * @returns Valid integer or undefined.
 */
function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Reads an optional positive safe integer and distinguishes invalid values.
 *
 * @param value Candidate optional budget.
 * @returns Number, undefined when absent, or null when invalid.
 */
function readOptionalPositiveInteger(value: unknown): number | undefined | null {
  if (value === undefined) {
    return undefined;
  } else {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
      return value;
    } else {
      return null;
    }
  }
}

/**
 * Reads an optional non-negative number and distinguishes invalid values.
 *
 * @param value Candidate optional timestamp.
 * @returns Number, undefined when absent, or null when invalid.
 */
function readOptionalNonNegativeNumber(value: unknown): number | undefined | null {
  return value === undefined ? undefined : (readNonNegativeNumber(value) ?? null);
}
