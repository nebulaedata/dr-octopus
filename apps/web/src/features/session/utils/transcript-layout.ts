/**
 * @author Codex
 * @description Groups visually adjacent tools without crossing visible content or explicit Turn boundaries.
 */
import { getLastItemIndexByTurn } from './turn-transcript-model';
import type { MessageProjection, SessionProjectionState, TranscriptItem } from '@/stores/session';

export type TranscriptLayoutRow =
  | { type: 'item'; item: Exclude<TranscriptItem, { type: 'tool' }> }
  | { type: 'tools'; id: string; toolIds: string[]; turnId?: string }
  | { type: 'turn-end'; turnId: string };

/**
 * Shares the existing message visibility contract between grouping and individual message rows.
 */
export function isTranscriptMessageVisible(
  message: MessageProjection | undefined,
  isStreaming: boolean,
  turnStatus?: 'running' | 'completed'
): boolean {
  if (message === undefined) {
    return false;
  }
  if (
    message.stopReason === 'error' &&
    message.interrupted !== true &&
    (message.retryId !== undefined || turnStatus === 'running')
  ) {
    return false;
  }
  if (isStreaming || message.interrupted === true || message.errorMessage !== undefined) {
    return true;
  }
  return (
    (message.attachments?.length ?? 0) > 0 ||
    message.content.some((block) => {
      if (block.type === 'text' || block.type === 'thinking') {
        return block.text.trim().length > 0;
      }
      return block.type === 'image' || block.type === 'file';
    })
  );
}

/**
 * Returns only visibility identities so streaming content changes do not rerender the transcript shell.
 */
export function selectVisibleTranscriptMessageIds(state: SessionProjectionState): string[] {
  return state.transcriptItems.flatMap((item) =>
    item.type === 'message' &&
    isTranscriptMessageVisible(
      state.messagesById[item.id],
      state.currentAssistantId === item.id,
      item.turnId === undefined ? undefined : state.turnsById[item.turnId]?.status
    )
      ? [item.id]
      : []
  );
}

/**
 * Keeps tool-group identity stable while appending tools and retains markers after hidden final messages.
 * Missing Turn ownership is treated conservatively: unknown tools are never merged across records.
 */
export function groupTranscriptRows(
  items: TranscriptItem[],
  visibleMessageIds: readonly string[]
): TranscriptLayoutRow[] {
  const visible = new Set(visibleMessageIds);
  const lastByTurn = getLastItemIndexByTurn(items);
  const rows: TranscriptLayoutRow[] = [];
  items.forEach((item, index) => {
    const turnId = 'turnId' in item ? item.turnId : undefined;
    const previous = rows.at(-1);
    if (item.type === 'tool') {
      if (previous?.type === 'tools' && turnId !== undefined && previous.turnId === turnId) {
        previous.toolIds.push(item.id);
      } else {
        rows.push({ type: 'tools', id: item.id, toolIds: [item.id], turnId });
      }
    } else if (item.type !== 'message' || visible.has(item.id)) {
      rows.push({ type: 'item', item });
    }
    if (turnId !== undefined && lastByTurn.get(turnId) === index) {
      rows.push({ type: 'turn-end', turnId });
    }
  });
  return rows;
}
