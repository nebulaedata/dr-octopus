/**
 * @author Codex
 * @description 将 Pi AgentMessage 转为浏览器稳定消息结构。
 */

import { isCancellationMessage } from '@octopus/shared/utils';
import { normalizeToolResult } from './tool-result-projection';
import { normalizeTokenUsage } from './token-usage';
import { projectPersistedRetries } from './persisted-retry-projection';
import { MessageAttachmentSchema } from '@octopus/shared/protocol/attachments';
import type { ContentBlock, MessageProjection, ToolProjection, TranscriptItem, TurnProjection } from '../type';

export interface PersistedTranscriptProjection {
  messages: MessageProjection[];
  tools: ToolProjection[];
  transcriptItems: TranscriptItem[];
  turns: TurnProjection[];
}

/**
 * Honors Pi custom-message presentation metadata without removing the message from runtime context.
 *
 * @param value - Raw Pi message received from history or a live lifecycle event.
 * @returns Whether the message belongs in the user-visible transcript.
 */
export function shouldProjectMessage(value: unknown): boolean {
  return !isRecord(value) || value['display'] !== false;
}

/**
 * 将运行时消息对象归一化为浏览器稳定的 MessageProjection。
 *
 * @param value - 来自 Pi runtime 的原始消息对象。
 * @param fallbackId - 当消息缺少唯一标识时使用的备选 ID。
 * @returns 归一化后的消息投影。
 */
export function normalizeMessage(value: unknown, fallbackId: string): MessageProjection {
  const message = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const roleValue = String(message['role'] ?? 'custom');
  const role: MessageProjection['role'] =
    roleValue === 'user' || roleValue === 'assistant' || roleValue === 'toolResult' || roleValue === 'system'
      ? roleValue
      : 'custom';
  const rawContent = message['content'];
  const tokenUsage = role === 'assistant' ? normalizeTokenUsage(message['usage']) : undefined;
  const content: ContentBlock[] = normalizeContent(rawContent);
  const timestamp = parseTimestamp(message['timestamp']);
  const persistedAt = parseTimestamp(message['persistedAt']);
  const stopReason = typeof message['stopReason'] === 'string' ? message['stopReason'] : undefined;
  const errorMessage =
    typeof message['errorMessage'] === 'string' && message['errorMessage'].trim().length > 0
      ? message['errorMessage'].trim()
      : undefined;
  const hasThinking = content.some((block) => block.type === 'thinking' && block.text.length > 0);
  const attachments = Array.isArray(message['attachments'])
    ? message['attachments'].flatMap((item) => {
        const parsed = MessageAttachmentSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  /**
   * Selects is cancellation messagestop reasone in the existing condition order.
   */
  function projectMessageFailure() {
    if (isCancellationMessage({ stopReason, errorMessage })) {
      return { interrupted: true };
    } else if (errorMessage === undefined) {
      return {};
    } else {
      return { errorMessage };
    }
  }
  return {
    id: String(message['id'] ?? message['timestamp'] ?? fallbackId),
    role,
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    content,
    ...(roleValue === 'custom' && typeof message['customType'] === 'string'
      ? { customType: message['customType'] }
      : {}),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(persistedAt === undefined ? {} : { persistedAt }),
    ...(hasThinking && timestamp !== undefined ? { thinkingStartedAt: timestamp } : {}),
    ...(hasThinking && persistedAt !== undefined ? { thinkingEndedAt: persistedAt } : {}),
    ...(typeof message['entryId'] === 'string' ? { entryId: message['entryId'] } : {}),
    ...(stopReason === undefined ? {} : { stopReason }),
    // Cancellation diagnostics are not model failures; message_end is already terminal.
    ...projectMessageFailure(),
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

/**
 * Reconstructs the durable transcript, including tool calls that Pi stores inside assistant messages.
 *
 * @param values - Ordered runtime messages enriched with Session entry metadata.
 * @returns Browser messages, tool executions, and their shared display order.
 */
export function projectPersistedTranscript(values: unknown[]): PersistedTranscriptProjection {
  const messages: MessageProjection[] = [];
  const toolsById = new Map<string, ToolProjection>();
  const transcriptItems: TranscriptItem[] = [];
  const turnsById = new Map<string, TurnProjection>();
  let activeTurnId: string | undefined;
  values.forEach((value, index) => {
    if (!shouldProjectMessage(value)) {
      return;
    }
    const raw = isRecord(value) ? value : {};
    const message = normalizeMessage(value, `history-${String(index)}`);
    if (message.role === 'user') {
      activeTurnId = `turn-message-${message.id}`;
      const startedAt = message.timestamp ?? message.persistedAt ?? 0;
      turnsById.set(activeTurnId, {
        id: activeTurnId,
        startedByMessageId: message.id,
        startedAt,
        endedAt: message.persistedAt ?? message.timestamp ?? startedAt,
        status: 'completed',
      });
    }
    if (message.role === 'toolResult') {
      projectToolResult(raw, message, toolsById, transcriptItems, activeTurnId);
      updatePersistedTurnEnd(turnsById, activeTurnId, message.persistedAt ?? message.timestamp);
      return;
    }
    messages.push(message);
    transcriptItems.push({
      type: 'message',
      id: message.id,
      ...(activeTurnId === undefined ? {} : { turnId: activeTurnId }),
    });
    updatePersistedTurnEnd(turnsById, activeTurnId, message.persistedAt ?? message.timestamp);
    if (message.role === 'assistant') {
      projectToolCalls(raw, message, toolsById, transcriptItems, activeTurnId);
    }
  });
  projectPersistedRetries(messages, transcriptItems, turnsById);
  return { messages, tools: [...toolsById.values()], transcriptItems, turns: [...turnsById.values()] };
}

/**
 * Projects assistant tool-call blocks at their durable location in the transcript.
 */
function projectToolCalls(
  raw: Record<string, unknown>,
  message: MessageProjection,
  toolsById: Map<string, ToolProjection>,
  transcriptItems: TranscriptItem[],
  turnId: string | undefined
): void {
  const content = Array.isArray(raw['content']) ? raw['content'] : [];
  for (const value of content) {
    if (!isRecord(value) || value['type'] !== 'toolCall') {
      continue;
    }
    const id = String(value['id'] ?? '');
    if (id.length === 0 || toolsById.has(id)) {
      continue;
    }
    toolsById.set(id, {
      id,
      name: String(value['name'] ?? 'tool'),
      status: 'running',
      arguments: value['arguments'],
      content: [],
      startedAt: message.persistedAt ?? message.timestamp ?? 0,
    });
    transcriptItems.push({ type: 'tool', id, ...(turnId === undefined ? {} : { turnId }) });
  }
}

/**
 * Merges one durable tool result into its preceding call without adding a message row.
 */
function projectToolResult(
  raw: Record<string, unknown>,
  message: MessageProjection,
  toolsById: Map<string, ToolProjection>,
  transcriptItems: TranscriptItem[],
  turnId: string | undefined
): void {
  const id = String(raw['toolCallId'] ?? '');
  if (id.length === 0) {
    return;
  }
  const existing = toolsById.get(id);
  const endedAt = message.persistedAt ?? message.timestamp;
  const result = normalizeToolResult(raw);
  toolsById.set(id, {
    id,
    name: String(raw['toolName'] ?? existing?.name ?? 'tool'),
    status: raw['isError'] === true ? 'error' : 'success',
    arguments: existing?.arguments,
    ...result,
    startedAt: existing?.startedAt ?? message.timestamp ?? endedAt ?? 0,
    ...(endedAt === undefined ? {} : { endedAt }),
  });
  if (existing === undefined) {
    transcriptItems.push({ type: 'tool', id, ...(turnId === undefined ? {} : { turnId }) });
  }
}

/**
 * Advances a hydrated Turn's durable end without allowing missing timestamps to corrupt its boundary.
 */
function updatePersistedTurnEnd(
  turnsById: Map<string, TurnProjection>,
  turnId: string | undefined,
  endedAt: number | undefined
): void {
  if (turnId === undefined || endedAt === undefined) {
    return;
  }
  const turn = turnsById.get(turnId);
  if (turn !== undefined) {
    turnsById.set(turnId, { ...turn, endedAt: Math.max(turn.endedAt ?? turn.startedAt, endedAt) });
  }
}

/**
 * Parses either Pi's epoch-millisecond message time or an ISO persistence time.
 */
function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Narrows unknown runtime values before reading protocol fields.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 将运行时 content 字段归一化为 ContentBlock 数组。
 *
 * @param rawContent - 原始 content，可能是字符串或数组。
 * @returns 稳定的 ContentBlock 数组。
 */
function normalizeContent(rawContent: unknown): ContentBlock[] {
  if (typeof rawContent === 'string') {
    return [{ type: 'text', text: rawContent }];
  }
  if (!Array.isArray(rawContent)) {
    return [];
  }
  return rawContent.flatMap((part): ContentBlock[] => {
    if (typeof part !== 'object' || part === null) {
      return [];
    }
    const block = part as Record<string, unknown>;
    if (block['type'] === 'text') {
      return [{ type: 'text', text: String(block['text'] ?? '') }];
    }
    if (block['type'] === 'thinking') {
      return [{ type: 'thinking', text: String(block['thinking'] ?? block['text'] ?? '') }];
    }
    if (block['type'] === 'image') {
      return [
        {
          type: 'image',
          data: String(block['data'] ?? ''),
          mimeType: String(block['mimeType'] ?? ''),
        },
      ];
    }
    if (block['type'] === 'file') {
      return [
        {
          type: 'file',
          name: String(block['name'] ?? ''),
          size: typeof block['size'] === 'number' ? block['size'] : 0,
          mimeType: String(block['mimeType'] ?? ''),
          data: String(block['data'] ?? ''),
        },
      ];
    }
    return [];
  });
}
