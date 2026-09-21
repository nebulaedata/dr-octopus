/**
 * @author Codex
 * @description 对单 runtime sequence 去重并归并 Pi JSON event。
 */

import { v4 as uuidv4 } from 'uuid';
import { normalizeMessage, shouldProjectMessage } from './normalizer';
import { endAutoRetry, markActiveRetryRunning, startAutoRetry } from './retry-reducer';
import { mergeToolResultProjection } from './tool-result-projection';
import { isThinkingLevel } from '@octopus/shared/protocol';
import type {
  HostEventEnvelope,
  PermissionStateDto,
  RuntimeProjectionState,
  SubagentFleetSnapshotDto,
} from '@octopus/shared/protocol';
import type { SessionProjectionState, ToolProjection } from './type';

/**
 * Checks whether a payload carries an agent state update.
 */
function isAgentStatePayload(
  payload: unknown
): payload is { state?: RuntimeProjectionState; permission?: PermissionStateDto } {
  return typeof payload === 'object' && payload !== null && 'state' in payload;
}

/**
 * Checks whether a payload carries an Extension UI request.
 */
function isExtensionUiPayload(
  payload: unknown
): payload is { method?: string; id?: string; message?: string; notifyType?: string } {
  return typeof payload === 'object' && payload !== null && 'method' in payload;
}

/**
 * Checks whether a payload can be treated as an agent event record.
 */
function isAgentEventPayload(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null;
}

/**
 * Checks the version discriminator on a server-validated Subagent Fleet snapshot.
 */
function isSubagentFleetSnapshot(payload: unknown): payload is SubagentFleetSnapshotDto {
  return (
    isRecord(payload) &&
    payload['kind'] === 'pi-subagents.async-status-snapshot' &&
    payload['version'] === 1 &&
    Array.isArray(payload['runs'])
  );
}

/**
 * Checks whether a value is a plain object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 按 sequence 去重并分发 Pi Host event。
 *
 * @param state - 当前投影状态。
 * @param envelope - 来自 Host 的有序事件信封。
 * @returns 更新后的投影状态；无效事件返回原状态引用。
 */
export function reduceEvent(
  state: SessionProjectionState,
  envelope: HostEventEnvelope
): SessionProjectionState {
  if (state.runtimeId !== undefined && state.runtimeId !== envelope.runtimeId) {
    return state;
  }
  if (state.epoch !== undefined && state.epoch !== envelope.epoch) {
    return state;
  }
  if (envelope.sequence <= state.lastSequence) {
    return state;
  }
  const envelopeTimestamp = Date.parse(envelope.timestamp);
  const next: SessionProjectionState = {
    ...state,
    runtimeId: envelope.runtimeId,
    epoch: envelope.epoch,
    lastSequence: envelope.sequence,
    lastServerTimestamp: Number.isFinite(envelopeTimestamp)
      ? Math.max(state.lastServerTimestamp, envelopeTimestamp)
      : state.lastServerTimestamp,
    needsReconcile: state.lastSequence > 0 && envelope.sequence > state.lastSequence + 1,
    ...('memory' in envelope ? { memory: envelope.memory ?? undefined } : {}),
    ...('backgroundTasks' in envelope ? { backgroundTasks: envelope.backgroundTasks } : {}),
    ...('goal' in envelope ? { goal: envelope.goal ?? undefined } : {}),
    ...(envelope.planMode === undefined ? {} : { planMode: envelope.planMode }),
  };
  if (envelope.type === 'agent.state' && isAgentStatePayload(envelope.payload)) {
    const runtimeState = envelope.payload.state ?? next.runtimeState;
    return {
      ...next,
      runtimeState,
      ...(runtimeState === 'recovering'
        ? {
            permission: { mode: 'ask', scope: 'runtime-generation', persisted: false },
            pendingExtensionUi: [],
            subagentFleet: undefined,
            backgroundTasks: undefined,
            memory: undefined,
            goal: envelope.goal ?? undefined,
            activeRetryId: undefined,
          }
        : envelope.payload.permission === undefined
          ? {}
          : { permission: envelope.payload.permission }),
    };
  }
  if (envelope.type === 'subagents.state') {
    return envelope.payload === null
      ? { ...next, subagentFleet: undefined }
      : isSubagentFleetSnapshot(envelope.payload)
        ? { ...next, subagentFleet: envelope.payload }
        : next;
  }
  if (envelope.type === 'extension.ui' && isExtensionUiPayload(envelope.payload)) {
    const method = envelope.payload.method;
    if (method === 'select' || method === 'confirm' || method === 'input' || method === 'editor') {
      return { ...next, pendingExtensionUi: [...next.pendingExtensionUi, envelope] };
    }
    if (method === 'notify') {
      return projectExtensionNotification(
        next,
        envelope.payload,
        envelope.requestId,
        envelopeTimestamp,
        envelope.sequence
      );
    }
    return next;
  }
  if (envelope.type !== 'agent.event') {
    return next;
  }
  return isAgentEventPayload(envelope.payload)
    ? reduceAgentEvent(next, envelope.payload, envelope.requestId, envelopeTimestamp, envelope.sequence)
    : next;
}

/**
 * Projects a fire-and-forget Extension UI notification as a completed command response.
 *
 * Extension slash commands do not enter Pi's Agent message lifecycle. The correlated notification therefore
 * owns both the visible response and the transition out of the browser's optimistic starting state.
 *
 * @param state - Session projection after accepting the ordered Host event.
 * @param payload - RPC Extension UI notification payload.
 * @param requestId - Originating slash-command request identity when available.
 * @param eventTimestamp - Server timestamp for the notification.
 * @param sequence - Monotonic runtime sequence used as a fallback identity.
 * @returns Projection containing the notification response and settled optimistic command state.
 */
function projectExtensionNotification(
  state: SessionProjectionState,
  payload: { id?: string; message?: string; notifyType?: string },
  requestId: string | undefined,
  eventTimestamp: number,
  sequence: number
): SessionProjectionState {
  const text = typeof payload.message === 'string' ? payload.message : '';
  const id = `extension-notify-${payload.id ?? String(sequence)}`;
  const exists = state.notificationsById[id] !== undefined;
  const timestamp = resolveTimestamp(eventTimestamp);
  const turnId = state.activeTurnId;
  const correlatedTurn =
    turnId === undefined
      ? undefined
      : state.messagesById[state.turnsById[turnId]?.startedByMessageId ?? '']?.correlationRequestId;
  const turnState =
    requestId !== undefined && correlatedTurn === requestId
      ? completeActiveTurn(state, timestamp)
      : advanceActiveTurn(state, timestamp);
  return {
    ...state,
    ...turnState,
    runtimeState: requestId !== undefined && state.runtimeState === 'starting' ? 'idle' : state.runtimeState,
    pendingUserRequestIds:
      requestId === undefined
        ? state.pendingUserRequestIds
        : state.pendingUserRequestIds.filter((candidate) => candidate !== requestId),
    notificationsById: {
      ...state.notificationsById,
      [id]: {
        id,
        message: text,
        timestamp,
        ...(payload.notifyType === undefined ? {} : { notifyType: payload.notifyType }),
        ...(requestId === undefined ? {} : { requestId }),
      },
    },
    transcriptItems: exists
      ? state.transcriptItems
      : [
          ...state.transcriptItems,
          { type: 'notification' as const, id, ...(turnId === undefined ? {} : { turnId }) },
        ],
  };
}

/**
 * 归并 message、tool、queue 和生命周期事件。
 *
 * @param state - 已更新 sequence 后的中间状态。
 * @param event - agent.event 的 payload。
 * @param requestId - 服务端为用户消息补充的原始命令标识。
 * @param eventTimestamp - 事件到达服务端时记录的时间戳。
 * @returns 更新后的投影状态。
 */
function reduceAgentEvent(
  state: SessionProjectionState,
  event: Record<string, unknown>,
  requestId: string | undefined,
  eventTimestamp: number,
  sequence: number
): SessionProjectionState {
  const type = String(event['type'] ?? '');
  if (type === 'extension_error') {
    return { ...state, error: formatExtensionError(event) };
  }
  if (type === 'thinking_level_changed' && isThinkingLevel(event['level'])) {
    return { ...state, thinking: { ...state.thinking, level: event['level'] } };
  }
  if (type === 'message_start') {
    const rawMessage = event['message'];
    if (!shouldProjectMessage(rawMessage)) {
      return state;
    }
    const message = normalizeMessage(rawMessage, `stream-${uuidv4()}`);
    if (message.role === 'user') {
      return reconcileOptimisticUserMessage(state, message, requestId, eventTimestamp);
    }
    if (message.role === 'toolResult') {
      return state;
    }
    const timestamp = message.timestamp ?? resolveTimestamp(eventTimestamp);
    const retryingState = message.role === 'assistant' ? markActiveRetryRunning(state) : state;
    const turnId = retryingState.activeTurnId;
    return {
      ...retryingState,
      ...advanceActiveTurn(retryingState, timestamp),
      messageIds: [...retryingState.messageIds, message.id],
      transcriptItems: [
        ...retryingState.transcriptItems,
        { type: 'message' as const, id: message.id, ...(turnId === undefined ? {} : { turnId }) },
      ],
      messagesById: {
        ...retryingState.messagesById,
        [message.id]:
          message.role === 'assistant'
            ? { ...message, timestamp, thinkingStartedAt: timestamp }
            : { ...message, timestamp },
      },
      currentAssistantId: message.role === 'assistant' ? message.id : retryingState.currentAssistantId,
    };
  }
  if (type === 'message_update' && state.currentAssistantId !== undefined) {
    const delta = isRecord(event['assistantMessageEvent']) ? event['assistantMessageEvent'] : undefined;
    return reduceMessageUpdate(state, delta, eventTimestamp);
  }
  if (type === 'message_end') {
    return reduceMessageEnd(state, event['message'], requestId, eventTimestamp);
  }
  if (type === 'auto_retry_start') {
    return startAutoRetry(state, event, eventTimestamp, sequence);
  }
  if (type === 'auto_retry_end') {
    return endAutoRetry(state, event, eventTimestamp, sequence);
  }
  if (type === 'agent_settled') {
    return {
      ...state,
      ...completeActiveTurn(state, eventTimestamp),
      activeRetryId: undefined,
    };
  }
  if (type === 'compaction_start' || type === 'auto_compaction_start') {
    return startCompaction(state, event, eventTimestamp, sequence);
  }
  if (type === 'compaction_end' || type === 'auto_compaction_end') {
    return endCompaction(state, event, eventTimestamp, sequence);
  }
  if (type === 'tool_execution_start' || type === 'tool_execution_update' || type === 'tool_execution_end') {
    return reduceToolEvent(state, event, type, eventTimestamp);
  }
  if (type === 'queue_update') {
    return {
      ...state,
      queue: {
        steering: Array.isArray(event['steering']) ? event['steering'] : [],
        followUp: Array.isArray(event['followUp']) ? event['followUp'] : [],
      },
    };
  }
  return state;
}

/**
 * Formats a Pi extension failure for the existing Session error Alert.
 *
 * Command identities are safe and useful to display, while extension file paths stay private.
 *
 * @param event - Pi extension_error payload.
 * @returns User-facing error text.
 */
function formatExtensionError(event: Record<string, unknown>): string {
  const rawError = typeof event['error'] === 'string' ? event['error'].trim() : '';
  const message = rawError.length > 0 ? rawError : 'An extension failed without an error message.';
  const extensionPath = typeof event['extensionPath'] === 'string' ? event['extensionPath'] : '';
  if (extensionPath.startsWith('command:')) {
    const command = extensionPath.slice('command:'.length);
    return command.length > 0
      ? `Extension command "/${command}" failed: ${message}`
      : `Extension command failed: ${message}`;
  }
  return `Extension error: ${message}`;
}

/**
 * Appends one visible compaction lifecycle row at its runtime event position.
 *
 * @param state - Current Session projection.
 * @param event - Pi compaction start event.
 * @param eventTimestamp - Server timestamp for the start event.
 * @param sequence - Monotonic runtime sequence used as a stable row identity.
 * @returns Projection with an active compaction row and invalidated context usage.
 */
function startCompaction(
  state: SessionProjectionState,
  event: Record<string, unknown>,
  eventTimestamp: number,
  sequence: number
): SessionProjectionState {
  const settledState = completeActiveTurn(state, eventTimestamp);
  const id = `compaction-${String(sequence)}`;
  const reason = normalizeCompactionReason(event['reason']);
  return {
    ...state,
    ...settledState,
    compactionsById: {
      ...state.compactionsById,
      [id]: {
        id,
        status: 'running',
        reason,
        startedAt: resolveTimestamp(eventTimestamp),
      },
    },
    activeCompactionId: id,
    transcriptItems: [...state.transcriptItems, { type: 'compaction', id }],
    ...(state.contextUsage === undefined
      ? {}
      : { contextUsage: { ...state.contextUsage, tokens: null, percent: null } }),
  };
}

/**
 * Settles the active compaction row, including Pi validation failures that reject the RPC command.
 *
 * @param state - Current Session projection.
 * @param event - Pi compaction end event.
 * @param eventTimestamp - Server timestamp for the end event.
 * @param sequence - Monotonic runtime sequence used when a start event was missed.
 * @returns Projection with a terminal success or error compaction row.
 */
function endCompaction(
  state: SessionProjectionState,
  event: Record<string, unknown>,
  eventTimestamp: number,
  sequence: number
): SessionProjectionState {
  const id = state.activeCompactionId ?? `compaction-${String(sequence)}`;
  const existing = state.compactionsById[id];
  const errorMessage = typeof event['errorMessage'] === 'string' ? event['errorMessage'] : undefined;
  const status = errorMessage !== undefined ? 'error' : event['aborted'] === true ? 'aborted' : 'success';
  const projection = {
    id,
    status,
    reason: existing?.reason ?? normalizeCompactionReason(event['reason']),
    startedAt: existing?.startedAt ?? resolveTimestamp(eventTimestamp),
    endedAt: resolveTimestamp(eventTimestamp),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  } as const;
  return {
    ...state,
    compactionsById: { ...state.compactionsById, [id]: projection },
    activeCompactionId: undefined,
    transcriptItems:
      existing === undefined ? [...state.transcriptItems, { type: 'compaction', id }] : state.transcriptItems,
  };
}

/**
 * Normalizes forward-compatible Pi compaction reasons to the browser projection contract.
 *
 * @param reason - Raw event reason.
 * @returns A supported compaction reason.
 */
function normalizeCompactionReason(reason: unknown): 'manual' | 'threshold' | 'overflow' {
  return reason === 'threshold' || reason === 'overflow' ? reason : 'manual';
}

/**
 * Replaces the exactly correlated pending row with Pi's authoritative user message.
 *
 * The Channel protocol enriches Pi user events with their originating request ID, allowing independent
 * browser tabs and identical concurrent prompts to reconcile without content-based guessing.
 *
 * @param state - Current Session projection.
 * @param message - Authoritative user message emitted by Pi.
 * @param requestId - Originating realtime command identity supplied by the server.
 * @returns Projection with the pending row replaced, or the authoritative row appended when unmatched.
 */
function reconcileOptimisticUserMessage(
  state: SessionProjectionState,
  message: SessionProjectionState['messagesById'][string],
  requestId: string | undefined,
  eventTimestamp: number
): SessionProjectionState {
  const pendingUserRequestIds =
    requestId === undefined
      ? state.pendingUserRequestIds
      : state.pendingUserRequestIds.filter((candidate) => candidate !== requestId);
  const existingMessage = state.messagesById[message.id];
  if (existingMessage !== undefined) {
    const turnId = findMessageTurnId(state, message.id);
    return {
      ...state,
      ...updateTurnStart(state, turnId, message.id, message.timestamp ?? resolveTimestamp(eventTimestamp)),
      messagesById: {
        ...state.messagesById,
        [message.id]: {
          ...message,
          correlationRequestId: requestId ?? existingMessage.correlationRequestId,
        },
      },
      pendingUserRequestIds,
    };
  }
  const optimisticIndex = state.messageIds.findIndex(
    (id) => requestId !== undefined && state.messagesById[id]?.correlationRequestId === requestId
  );
  const correlatedMessage =
    requestId === undefined ? message : { ...message, correlationRequestId: requestId };
  if (optimisticIndex === -1) {
    const turnState = startUserTurn(
      state,
      message.id,
      message.timestamp ?? resolveTimestamp(eventTimestamp),
      requestId
    );
    return {
      ...state,
      ...turnState,
      messageIds: [...state.messageIds, message.id],
      messagesById: { ...state.messagesById, [message.id]: correlatedMessage },
      transcriptItems: [
        ...state.transcriptItems,
        { type: 'message', id: message.id, turnId: turnState.activeTurnId },
      ],
      pendingUserRequestIds,
    };
  }

  const optimisticId = state.messageIds[optimisticIndex];
  const turnId = findMessageTurnId(state, optimisticId);
  const messageIds = [...state.messageIds];
  messageIds[optimisticIndex] = message.id;
  const messagesById = { ...state.messagesById };
  delete messagesById[optimisticId];
  messagesById[message.id] = correlatedMessage;
  const transcriptItems = state.transcriptItems.map((item) =>
    item.type === 'message' && item.id === optimisticId ? { ...item, id: message.id } : item
  );
  return {
    ...state,
    ...updateTurnStart(state, turnId, message.id, message.timestamp ?? resolveTimestamp(eventTimestamp)),
    messageIds,
    messagesById,
    transcriptItems,
    pendingUserRequestIds,
  };
}

/**
 * 将 assistant message delta 追加到当前助手消息。
 *
 * @param state - 当前投影状态。
 * @param delta - 当前消息内容增量。
 * @param eventTimestamp - 此增量的服务端时间戳。
 * @returns 合并内容和思考生命周期后的投影。
 */
function reduceMessageUpdate(
  state: SessionProjectionState,
  delta: Record<string, unknown> | undefined,
  eventTimestamp: number
): SessionProjectionState {
  if (delta === undefined || state.currentAssistantId === undefined) {
    return state;
  }
  const current = state.messagesById[state.currentAssistantId];
  if (current === undefined) {
    return state;
  }
  const content = [...current.content];
  const index = typeof delta['contentIndex'] === 'number' ? delta['contentIndex'] : 0;
  const deltaType = String(delta['type'] ?? '');
  if (deltaType === 'text_delta' || deltaType === 'thinking_delta') {
    const blockType = deltaType === 'thinking_delta' ? 'thinking' : 'text';
    while (content.length <= index) {
      content.push({ type: blockType, text: '' });
    }
    const previous = content[index];
    content[index] = {
      type: blockType,
      text: `${previous?.type === blockType ? (previous.text ?? '') : ''}${String(delta['delta'] ?? '')}`,
    };
  }
  const timestamp = resolveTimestamp(eventTimestamp);
  const thinkingStartedAt =
    deltaType === 'thinking_delta' ? (current.thinkingStartedAt ?? timestamp) : current.thinkingStartedAt;
  const thinkingEndedAt =
    deltaType === 'text_delta' && current.thinkingEndedAt === undefined ? timestamp : current.thinkingEndedAt;
  return {
    ...state,
    ...advanceActiveTurn(state, timestamp),
    messagesById: {
      ...state.messagesById,
      [current.id]: { ...current, content, thinkingStartedAt, thinkingEndedAt },
    },
  };
}

/**
 * 将流式消息终止为最终消息。
 *
 * @param state - 当前投影状态。
 * @param rawMessage - runtime 给出的最终消息。
 * @param requestId - 与用户命令关联的请求标识。
 * @param eventTimestamp - 消息结束事件的服务端时间戳。
 * @returns 最终消息投影。
 */
function reduceMessageEnd(
  state: SessionProjectionState,
  rawMessage: unknown,
  requestId: string | undefined,
  eventTimestamp: number
): SessionProjectionState {
  if (!shouldProjectMessage(rawMessage)) {
    return state;
  }
  const finalMessage = normalizeMessage(rawMessage, `message-${uuidv4()}`);
  if (finalMessage.role === 'user') {
    return reconcileOptimisticUserMessage(state, finalMessage, requestId, eventTimestamp);
  }
  if (finalMessage.role === 'toolResult') {
    return state;
  }
  const id =
    finalMessage.role === 'assistant' ? (state.currentAssistantId ?? finalMessage.id) : finalMessage.id;
  const streamingMessage = state.messagesById[id];
  const contextUsage = projectContextUsage(state, rawMessage);
  const persistedAt = finalMessage.persistedAt ?? resolveTimestamp(eventTimestamp);
  const hasThinking = finalMessage.content.some(
    (block) => block.type === 'thinking' && block.text.length > 0
  );
  const thinkingStartedAt =
    streamingMessage?.thinkingStartedAt ??
    (hasThinking ? (finalMessage.timestamp ?? persistedAt) : undefined);
  const turnId = state.activeTurnId;
  return {
    ...state,
    ...advanceActiveTurn(state, persistedAt),
    messageIds: state.messagesById[id] === undefined ? [...state.messageIds, id] : state.messageIds,
    transcriptItems:
      state.messagesById[id] === undefined
        ? [
            ...state.transcriptItems,
            { type: 'message' as const, id, ...(turnId === undefined ? {} : { turnId }) },
          ]
        : state.transcriptItems,
    messagesById: {
      ...state.messagesById,
      [id]: {
        ...finalMessage,
        id,
        persistedAt,
        thinkingStartedAt,
        thinkingEndedAt: thinkingStartedAt === undefined ? undefined : persistedAt,
      },
    },
    currentAssistantId: finalMessage.role === 'assistant' ? undefined : state.currentAssistantId,
    ...(contextUsage === undefined ? {} : { contextUsage }),
  };
}

/**
 * Starts a stable user Turn after completing any previously active projection.
 */
function startUserTurn(
  state: SessionProjectionState,
  messageId: string,
  startedAt: number,
  requestId: string | undefined
): Pick<SessionProjectionState, 'turnsById'> & { activeTurnId: string } {
  const completed = completeActiveTurn(state, startedAt);
  const turnId = requestId === undefined ? `turn-message-${messageId}` : `turn-request-${requestId}`;
  return {
    turnsById: {
      ...completed.turnsById,
      [turnId]: {
        id: turnId,
        startedByMessageId: messageId,
        startedAt,
        status: 'running',
      },
    },
    activeTurnId: turnId,
  };
}

/**
 * Updates the authoritative user identity and timestamp without replacing its stable Turn identity.
 */
function updateTurnStart(
  state: SessionProjectionState,
  turnId: string | undefined,
  messageId: string,
  startedAt: number
): Pick<SessionProjectionState, 'turnsById'> {
  if (turnId === undefined || state.turnsById[turnId] === undefined) {
    return { turnsById: state.turnsById };
  }
  return {
    turnsById: {
      ...state.turnsById,
      [turnId]: { ...state.turnsById[turnId], startedByMessageId: messageId, startedAt },
    },
  };
}

/**
 * Advances the active Turn's last known durable activity time.
 */
function advanceActiveTurn(
  state: SessionProjectionState,
  endedAt: number
): Pick<SessionProjectionState, 'turnsById'> {
  const turnId = state.activeTurnId;
  const turn = turnId === undefined ? undefined : state.turnsById[turnId];
  if (turn === undefined) {
    return { turnsById: state.turnsById };
  }
  const timestamp = resolveTimestamp(endedAt);
  return {
    turnsById: {
      ...state.turnsById,
      [turn.id]: { ...turn, endedAt: Math.max(turn.endedAt ?? turn.startedAt, timestamp) },
    },
  };
}

/**
 * Closes the active Turn at its last activity, falling back to the supplied lifecycle timestamp.
 */
function completeActiveTurn(
  state: SessionProjectionState,
  fallbackEndedAt: number
): Pick<SessionProjectionState, 'turnsById' | 'activeTurnId'> {
  const turnId = state.activeTurnId;
  const turn = turnId === undefined ? undefined : state.turnsById[turnId];
  if (turn === undefined) {
    return { turnsById: state.turnsById, activeTurnId: undefined };
  }
  return {
    turnsById: {
      ...state.turnsById,
      [turn.id]: {
        ...turn,
        status: 'completed',
        endedAt: turn.endedAt ?? resolveTimestamp(fallbackEndedAt),
      },
    },
    activeTurnId: undefined,
  };
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
 * Falls back to the browser clock when a transport timestamp cannot be parsed.
 *
 * @param timestamp - Parsed transport timestamp.
 * @returns A valid millisecond timestamp.
 */
function resolveTimestamp(timestamp: number): number {
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

/**
 * Projects Pi's final assistant usage against the authoritative context window from the latest snapshot.
 */
function projectContextUsage(
  state: SessionProjectionState,
  rawMessage: unknown
): SessionProjectionState['contextUsage'] {
  if (state.contextUsage === undefined || !isRecord(rawMessage)) {
    return state.contextUsage;
  }
  const usage = rawMessage['usage'];
  if (!isRecord(usage)) {
    return state.contextUsage;
  }
  const totalTokens = usage['totalTokens'];
  const fallbackTotal = ['input', 'output', 'cacheRead', 'cacheWrite'].reduce(
    (total, key) => total + (typeof usage[key] === 'number' ? usage[key] : 0),
    0
  );
  const tokens = typeof totalTokens === 'number' && totalTokens > 0 ? totalTokens : fallbackTotal;
  if (tokens <= 0) {
    return state.contextUsage;
  }
  return {
    tokens,
    contextWindow: state.contextUsage.contextWindow,
    percent: (tokens / state.contextUsage.contextWindow) * 100,
  };
}

/**
 * 合并一次 tool 执行生命周期事件。
 */
function reduceToolEvent(
  state: SessionProjectionState,
  event: Record<string, unknown>,
  type: string,
  eventTimestamp: number
): SessionProjectionState {
  const id = String(event['toolCallId'] ?? event['id'] ?? uuidv4());
  const existing = state.toolsById[id];
  const rawResult = type === 'tool_execution_end' ? event['result'] : event['partialResult'];
  const result = mergeToolResultProjection(existing, rawResult);
  const tool: ToolProjection = {
    id,
    name: String(event['toolName'] ?? existing?.name ?? 'tool'),
    status: type === 'tool_execution_end' ? (event['isError'] ? 'error' : 'success') : 'running',
    arguments: event['args'] ?? existing?.arguments,
    ...result,
    startedAt: existing?.startedAt ?? resolveTimestamp(eventTimestamp),
    ...(type === 'tool_execution_end' ? { endedAt: resolveTimestamp(eventTimestamp) } : {}),
  };
  const timestamp = tool.endedAt ?? tool.startedAt;
  const turnId = state.activeTurnId;
  return {
    ...state,
    ...advanceActiveTurn(state, timestamp),
    toolIds: existing === undefined ? [...state.toolIds, id] : state.toolIds,
    transcriptItems:
      existing === undefined
        ? [
            ...state.transcriptItems,
            { type: 'tool' as const, id, ...(turnId === undefined ? {} : { turnId }) },
          ]
        : state.transcriptItems,
    toolsById: { ...state.toolsById, [id]: tool },
  };
}
