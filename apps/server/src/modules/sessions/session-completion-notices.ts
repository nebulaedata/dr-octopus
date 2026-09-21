/**
 * @author Codex
 * @description Projects settled interactive replies into durable, deduplicated Session notices.
 */
import type { SessionsService } from './sessions.service.js';
import type { SessionNotificationsRepository } from './session-notifications.repository.js';

/**
 * Skip focused Sessions without recording them; publish unseen final settlements with notice deduplication.
 */
export function subscribeSessionCompletionNotices(
  sessions: SessionsService,
  notices: SessionNotificationsRepository,
  onError: (error: unknown) => void,
  isSessionFocused: (sessionId: string) => boolean = () => false
): () => void {
  return sessions.onEvent((event) => {
    if (
      event.type !== 'agent.event' ||
      !event.payload ||
      typeof event.payload !== 'object' ||
      !('type' in event.payload) ||
      event.payload.type !== 'agent_settled'
    ) {
      return;
    }
    try {
      const session = sessions.getSession(event.sessionId);
      if (session.execution || isSessionFocused(session.id)) {
        return;
      }
      const transcript = sessions.getEntries(session.id);
      const entries = new Map(transcript.entries.map((candidate) => [candidate.id, candidate]));
      let entry = transcript.leafId ? entries.get(transcript.leafId) : undefined;
      while (entry && !(entry.type === 'message' && entry.message.role === 'assistant')) {
        entry = entry.parentId ? entries.get(entry.parentId) : undefined;
      }
      if (!entry || entry.type !== 'message' || entry.message.role !== 'assistant') {
        return;
      }
      const message = entry.message;
      const status =
        message.stopReason === 'error'
          ? 'failed'
          : message.stopReason === 'aborted'
            ? 'cancelled'
            : 'succeeded';
      const summary =
        message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .slice(0, 500) ||
        message.errorMessage ||
        (status === 'succeeded' ? '回复已完成' : '执行已结束，请查看会话详情');
      notices.publish({
        eventKey: `reply:${session.id}:${entry.id}`,
        workspaceId: session.workspaceId,
        sessionId: session.id,
        title: session.title,
        summary,
        status,
        createdAt: event.timestamp,
      });
    } catch (error) {
      onError(error);
    }
  });
}
