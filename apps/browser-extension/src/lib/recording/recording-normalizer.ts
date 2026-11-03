/**
 * @author Codex
 * @description Links directly observed anchor clicks to browser transitions without inventing causal evidence.
 */
import type { RecordedEvent, RecordingSession } from './recording-contract';

/**
 * Groups direct same-destination transitions while preserving every raw fact and its original sequence.
 */
export function normalizeRecordingEvents(
  session: RecordingSession,
  incoming: RecordedEvent[]
): RecordedEvent[] {
  const updates: RecordedEvent[] = [];
  for (const event of incoming) {
    session.actionCount++;
    if (event.source === 'browser' && ['navigate', 'tab_open'].includes(event.action)) {
      const click = session.recentEvents.findLast(
        (item) =>
          item.action === 'click' && item.targetUrl === event.url && Math.abs(item.at - event.at) < 2000
      );
      if (click) {
        event.causationId = click.id;
        session.actionCount--;
      }
    } else if (event.action === 'click' && event.targetUrl) {
      for (const previous of session.recentEvents) {
        if (
          previous.source === 'browser' &&
          !previous.causationId &&
          ['navigate', 'tab_open'].includes(previous.action) &&
          previous.url === event.targetUrl &&
          Math.abs(previous.at - event.at) < 2000
        ) {
          previous.causationId = event.id;
          updates.push({ ...previous });
          session.actionCount--;
        }
      }
    }
    session.recentEvents.push(event);
    session.recentEvents = session.recentEvents.slice(-20);
  }
  return updates;
}
