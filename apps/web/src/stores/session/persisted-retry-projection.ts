/**
 * @author Codex
 * @description Reconstructs completed retry episodes from durable Pi assistant messages.
 */

import type { AutoRetryProjection, MessageProjection, TranscriptItem, TurnProjection } from './type';

/**
 * Collapses durable assistant error runs into retry episodes when transient retry events are unavailable.
 *
 * A single terminal assistant error remains an ordinary model failure. Multiple trailing errors prove that at
 * least one retry ran, while any error run followed by a successful assistant message proves recovery.
 *
 * @param messages Mutable normalized durable messages.
 * @param transcriptItems Ordered rows carrying explicit Turn ownership.
 * @param turnsById Mutable Turn projections receiving reconstructed retry episodes.
 */
export function projectPersistedRetries(
  messages: MessageProjection[],
  transcriptItems: TranscriptItem[],
  turnsById: Map<string, TurnProjection>
): void {
  const messageIndexById = new Map(messages.map((message, index) => [message.id, index]));
  const messageIndexesByTurn = new Map<string, number[]>();
  for (const item of transcriptItems) {
    if (item.type !== 'message' || item.turnId === undefined) {
      continue;
    }
    const messageIndex = messageIndexById.get(item.id);
    if (messageIndex === undefined) {
      continue;
    }
    const indexes = messageIndexesByTurn.get(item.turnId) ?? [];
    indexes.push(messageIndex);
    messageIndexesByTurn.set(item.turnId, indexes);
  }
  for (const [turnId, indexes] of messageIndexesByTurn) {
    let errors: number[] = [];
    for (const messageIndex of indexes) {
      const message = messages[messageIndex];
      if (message.role !== 'assistant') {
        continue;
      }
      if (message.stopReason === 'error' && message.interrupted !== true) {
        errors.push(messageIndex);
        continue;
      }
      if (errors.length > 0 && message.interrupted !== true) {
        appendHistoricalRetry(messages, turnsById, turnId, errors, message);
      }
      errors = [];
    }
    if (errors.length > 1) {
      appendHistoricalRetry(messages, turnsById, turnId, errors);
    }
  }
}

/**
 * Adds one reconstructed retry episode and marks its transient assistant errors as retry-owned.
 *
 * @param messages Mutable normalized messages.
 * @param turnsById Mutable Turn map.
 * @param turnId Owning Turn identity.
 * @param errorIndexes Assistant error positions belonging to the episode.
 * @param recoveredMessage Successful assistant message that closed the episode, when present.
 */
function appendHistoricalRetry(
  messages: MessageProjection[],
  turnsById: Map<string, TurnProjection>,
  turnId: string,
  errorIndexes: number[],
  recoveredMessage?: MessageProjection
): void {
  const turn = turnsById.get(turnId);
  const firstError = messages[errorIndexes[0]];
  const lastError = messages[errorIndexes.at(-1)!];
  if (turn === undefined || firstError === undefined || lastError === undefined) {
    return;
  }
  const id = `retry-history-${turnId}-${firstError.id}`;
  const succeeded = recoveredMessage !== undefined;
  const scheduledAt = firstError.persistedAt ?? firstError.timestamp ?? turn.startedAt;
  const endedAt =
    recoveredMessage?.persistedAt ??
    recoveredMessage?.timestamp ??
    lastError.persistedAt ??
    lastError.timestamp ??
    scheduledAt;
  const errorMessage = lastError.errorMessage ?? 'Unknown model error';
  const retry: AutoRetryProjection = {
    id,
    status: succeeded ? 'succeeded' : 'failed',
    attempt: succeeded ? errorIndexes.length : errorIndexes.length - 1,
    errorMessage,
    ...(succeeded ? {} : { finalError: errorMessage }),
    scheduledAt,
    endedAt,
  };
  for (const messageIndex of errorIndexes) {
    messages[messageIndex] = { ...messages[messageIndex], retryId: id };
  }
  turnsById.set(turnId, { ...turn, retries: [...(turn.retries ?? []), retry] });
}
