/**
 * @author Codex
 * @description Applies persisted transcript previews without granting runtime readiness or consuming buffered events.
 */
import { projectPersistedTranscript } from './normalizer';
import type { SessionHistoryDto } from '@octopus/shared/protocol';
import type { SessionProjectionState } from './type';

/**
 * Ignores late or foreign previews once live hydration or optimistic work owns the transcript.
 */
export function applySessionHistory(
  state: SessionProjectionState,
  history: SessionHistoryDto
): SessionProjectionState {
  if (history.sessionId !== state.sessionId || state.hydrated || state.pendingUserRequestIds.length > 0) {
    return state;
  }
  const { messages, tools, transcriptItems, turns } = projectPersistedTranscript(history.messages);
  const feedback = new Map(history.messageFeedback.map((item) => [item.entryId, item.rating]));
  for (const message of messages) {
    if (message.entryId !== undefined) {
      message.feedback = feedback.get(message.entryId);
    }
  }
  return {
    ...state,
    historyLoaded: true,
    messageIds: messages.map((message) => message.id),
    messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
    toolIds: tools.map((tool) => tool.id),
    toolsById: Object.fromEntries(tools.map((tool) => [tool.id, tool])),
    turnsById: Object.fromEntries(turns.map((turn) => [turn.id, turn])),
    transcriptItems,
  };
}
