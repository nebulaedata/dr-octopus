/**
 * @author Codex
 * @description Projects Pi auto-retry lifecycle events into Turn-owned browser state.
 */

import type { AutoRetryProjection, MessageProjection, SessionProjectionState } from '@/stores/session/type';

/**
 * Creates or advances the active retry episode and assigns the preceding assistant error to it.
 *
 * @param state Current Session projection.
 * @param event Pi auto_retry_start payload.
 * @param eventTimestamp Server receive time for the retry schedule.
 * @param sequence Runtime sequence used for a stable live identity.
 * @returns Projection with one waiting retry episode on the active Turn.
 */
export function startAutoRetry(
  state: SessionProjectionState,
  event: Record<string, unknown>,
  eventTimestamp: number,
  sequence: number
): SessionProjectionState {
  const attempt = readPositiveInteger(event['attempt']);
  const maxAttempts = readPositiveInteger(event['maxAttempts']);
  const delayMs = readNonNegativeNumber(event['delayMs']);
  const errorMessage = readNonEmptyString(event['errorMessage']);
  const turnId = state.activeTurnId;
  const turn = turnId === undefined ? undefined : state.turnsById[turnId];
  if (
    attempt === undefined ||
    maxAttempts === undefined ||
    attempt > maxAttempts ||
    delayMs === undefined ||
    errorMessage === undefined ||
    turn === undefined
  ) {
    return state;
  }
  const retries = [...(turn.retries ?? [])];
  const activeIndex = retries.findIndex((retry) => retry.id === state.activeRetryId);
  const id = activeIndex === -1 ? `retry-${turn.id}-${String(sequence)}` : retries[activeIndex].id;
  const retry: AutoRetryProjection = {
    id,
    status: 'waiting',
    attempt,
    maxAttempts,
    delayMs,
    errorMessage,
    scheduledAt: resolveTimestamp(eventTimestamp),
  };
  if (activeIndex === -1) {
    retries.push(retry);
  } else {
    retries[activeIndex] = retry;
  }
  return assignLatestAssistantError(
    {
      ...state,
      turnsById: { ...state.turnsById, [turn.id]: { ...turn, retries } },
      activeRetryId: id,
    },
    turn.id,
    id
  );
}

/**
 * Finalizes the active retry episode using Pi's authoritative terminal outcome.
 *
 * @param state Current Session projection.
 * @param event Pi auto_retry_end payload.
 * @param eventTimestamp Server receive time for the terminal outcome.
 * @param sequence Runtime sequence used when the start event was missed.
 * @returns Projection with a terminal retry episode and no active retry identity.
 */
export function endAutoRetry(
  state: SessionProjectionState,
  event: Record<string, unknown>,
  eventTimestamp: number,
  sequence: number
): SessionProjectionState {
  const success = event['success'];
  const attempt = readPositiveInteger(event['attempt']);
  const turnId = state.activeTurnId;
  const turn = turnId === undefined ? undefined : state.turnsById[turnId];
  if (typeof success !== 'boolean' || attempt === undefined || turn === undefined) {
    return state;
  }
  const retries = [...(turn.retries ?? [])];
  const activeIndex = retries.findIndex((retry) => retry.id === state.activeRetryId);
  const latestError = findLatestAssistantError(state, turn.id);
  const finalError = readNonEmptyString(event['finalError']);
  const existing = activeIndex === -1 ? undefined : retries[activeIndex];
  const id = existing?.id ?? `retry-${turn.id}-${String(sequence)}`;
  const errorMessage =
    existing?.errorMessage ?? latestError?.errorMessage ?? finalError ?? 'Unknown model error';
  const retry: AutoRetryProjection = {
    id,
    status: success ? 'succeeded' : 'failed',
    attempt,
    ...(existing?.maxAttempts === undefined ? {} : { maxAttempts: existing.maxAttempts }),
    ...(existing?.delayMs === undefined ? {} : { delayMs: existing.delayMs }),
    errorMessage,
    ...(success ? {} : { finalError: finalError ?? errorMessage }),
    scheduledAt: existing?.scheduledAt ?? resolveTimestamp(eventTimestamp),
    endedAt: resolveTimestamp(eventTimestamp),
  };
  if (activeIndex === -1) {
    retries.push(retry);
  } else {
    retries[activeIndex] = retry;
  }
  const finalized = {
    ...state,
    turnsById: { ...state.turnsById, [turn.id]: { ...turn, retries } },
    activeRetryId: undefined,
  };
  return success ? finalized : assignLatestAssistantError(finalized, turn.id, id);
}

/**
 * Marks the active episode as executing once Pi starts the next assistant message.
 *
 * @param state Current Session projection.
 * @returns Projection with a retrying episode, or the original state when no retry is active.
 */
export function markActiveRetryRunning(state: SessionProjectionState): SessionProjectionState {
  const turnId = state.activeTurnId;
  const turn = turnId === undefined ? undefined : state.turnsById[turnId];
  const activeRetryId = state.activeRetryId;
  if (turn === undefined || activeRetryId === undefined) {
    return state;
  }
  const retries = turn.retries?.map((retry) =>
    retry.id === activeRetryId ? { ...retry, status: 'retrying' as const } : retry
  );
  return retries === undefined
    ? state
    : { ...state, turnsById: { ...state.turnsById, [turn.id]: { ...turn, retries } } };
}

/**
 * Associates the latest failed assistant message in a Turn with its owning retry episode.
 */
function assignLatestAssistantError(
  state: SessionProjectionState,
  turnId: string,
  retryId: string
): SessionProjectionState {
  const message = findLatestAssistantError(state, turnId);
  if (message === undefined) {
    return state;
  }
  return {
    ...state,
    messagesById: {
      ...state.messagesById,
      [message.id]: { ...message, retryId },
    },
  };
}

/**
 * Finds the newest assistant error explicitly owned by one Turn.
 */
function findLatestAssistantError(
  state: SessionProjectionState,
  turnId: string
): MessageProjection | undefined {
  for (let index = state.messageIds.length - 1; index >= 0; index -= 1) {
    const message = state.messagesById[state.messageIds[index]];
    if (message?.role === 'user') {
      return undefined;
    }
    if (
      message?.role === 'assistant' &&
      message.stopReason === 'error' &&
      message.interrupted !== true &&
      findMessageTurnId(state, message.id) === turnId
    ) {
      return message;
    }
  }
  return undefined;
}

/**
 * Finds the explicit Turn ownership recorded on one transcript message row.
 */
function findMessageTurnId(state: SessionProjectionState, messageId: string): string | undefined {
  const item = state.transcriptItems.find(
    (candidate) => candidate.type === 'message' && candidate.id === messageId
  );
  return item !== undefined && 'turnId' in item ? item.turnId : undefined;
}

/**
 * Reads a positive integer from an untrusted Pi event field.
 */
function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Reads a finite non-negative number from an untrusted Pi event field.
 */
function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Reads and trims a non-empty string from an untrusted Pi event field.
 */
function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Falls back to the browser clock when a transport timestamp cannot be parsed.
 */
function resolveTimestamp(timestamp: number): number {
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
