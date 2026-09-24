/**
 * @author Codex
 * @description 为单个 Session 维护归一化消息、流式增量、工具、队列与 Extension UI 投影。
 */

import { createStore } from 'zustand/vanilla';
import { combine } from 'zustand/middleware';
import { reduceEvent } from '@/stores/session/reducers/session-reducer';
import { applySessionHistory } from './utils/history';
import { projectPersistedTranscript } from './utils/normalizer';
import type { CommandAckMessage, SessionSnapshotDto } from '@octopus/shared/protocol';
import type { MessageProjection, SessionActions, SessionProjectionState, SessionStoreApi } from './type';

export type {
  AutoRetryProjection,
  CompactionProjection,
  ComposerAttachmentViewModel,
  ContentBlock,
  ExtensionNotificationProjection,
  MessageProjection,
  SessionActions,
  SessionProjectionState,
  SessionStoreApi,
  ToolProjection,
  TranscriptItem,
  TurnProjection,
} from './type';

/**
 * 创建与 React 生命周期无关的单 Session store。
 *
 * @param sessionId - 要绑定的 Session 标识。
 * @returns 可在外部持有并订阅的 vanilla Zustand store。
 */
export function createSessionStore(sessionId: string): SessionStoreApi {
  return createStore(
    combine(createInitialState(sessionId), (set) => ({
      beginBootstrap: () => set((state) => beginBootstrap(state)),
      hydrate: (snapshot) => set((state) => hydrateState(state, snapshot)),
      previewHistory: (history) => set((state) => applySessionHistory(state, history)),
      failBootstrap: (error) => set({ loadState: 'error', error }),
      applyEvent: (event) =>
        set((state) =>
          state.loadState === 'loading'
            ? { ...state, bufferedEvents: [...state.bufferedEvents, event] }
            : reduceEvent(state, event)
        ),
      appendOptimisticUserMessage: (requestId, text) =>
        set((state) => appendOptimisticUserMessage(state, requestId, text)),
      rejectOptimisticUserMessage: (requestId, error) =>
        set((state) => rejectOptimisticUserMessage(state, requestId, error)),
      acknowledgeUserCommand: (requestId, completion) =>
        set((state) => acknowledgeUserCommand(state, requestId, completion)),
      setDraft: (draft) => set({ draft }),
      setAttachments: (attachments) => set({ attachments }),
      setThinking: (thinking) => set({ thinking }),
      setPermission: (permission) => set({ permission }),
      beginWorkModeChange: (requestId, mode) =>
        set({ pendingWorkMode: { requestId, mode }, error: undefined }),
      setPlanMode: (planMode, requestId) =>
        set((state) => ({
          planMode,
          pendingWorkMode:
            requestId === undefined || requestId === state.pendingWorkMode?.requestId
              ? undefined
              : state.pendingWorkMode,
        })),
      rejectWorkModeChange: (requestId, error) =>
        set((state) =>
          state.pendingWorkMode?.requestId === requestId ? { pendingWorkMode: undefined, error } : state
        ),
      setError: (error) => set({ error }),
    }))
  );
}

/**
 * 构建 Session 投影初始状态。
 *
 * @param sessionId - Session 标识。
 * @returns 纯数据初始状态。
 */
function createInitialState(sessionId: string): Omit<SessionProjectionState, keyof SessionActions> {
  return {
    sessionId,
    loadState: 'uninitialized',
    runtimeState: 'dormant',
    lastSequence: 0,
    lastServerTimestamp: 0,
    needsReconcile: false,
    hydrated: false,
    historyLoaded: false,
    bufferedEvents: [],
    messageIds: [],
    messagesById: {},
    pendingUserRequestIds: [],
    toolsById: {},
    toolIds: [],
    compactionsById: {},
    notificationsById: {},
    turnsById: {},
    activeTurnId: undefined,
    activeRetryId: undefined,
    transcriptItems: [],
    queue: { steering: [], followUp: [] },
    pendingExtensionUi: [],
    subagentFleet: undefined,
    backgroundTasks: undefined,
    goal: undefined,
    memory: undefined,
    draft: '',
    attachments: [],
    contextUsage: undefined,
    thinking: { level: 'off', availableLevels: ['off'] },
    permission: { mode: 'ask', scope: 'runtime-generation', persisted: false },
    planMode: { available: false, workMode: 'agent', phase: 'off', awaitingAction: false },
    pendingWorkMode: undefined,
  };
}

/**
 * Clears generation-owned projection data before one fresh bootstrap attempt.
 *
 * @param state Current Session projection.
 * @returns Loading projection with browser-owned draft and attachments preserved.
 */
function beginBootstrap(state: SessionProjectionState): SessionProjectionState {
  return {
    ...state,
    runtimeId: undefined,
    epoch: undefined,
    runtimeState: 'starting',
    loadState: 'loading',
    historyLoaded: false,
    lastSequence: 0,
    lastServerTimestamp: 0,
    needsReconcile: false,
    hydrated: false,
    bufferedEvents: [],
    messageIds: [],
    messagesById: {},
    pendingUserRequestIds: [],
    currentAssistantId: undefined,
    toolsById: {},
    toolIds: [],
    compactionsById: {},
    activeCompactionId: undefined,
    notificationsById: {},
    turnsById: {},
    activeTurnId: undefined,
    activeRetryId: undefined,
    transcriptItems: [],
    queue: { steering: [], followUp: [] },
    pendingExtensionUi: [],
    subagentFleet: undefined,
    backgroundTasks: undefined,
    goal: undefined,
    memory: undefined,
    contextUsage: undefined,
    thinking: { level: 'off', availableLevels: ['off'] },
    permission: { mode: 'ask', scope: 'runtime-generation', persisted: false },
    planMode: { available: false, workMode: 'agent', phase: 'off', awaitingAction: false },
    pendingWorkMode: undefined,
    error: undefined,
  };
}

/**
 * 用服务端快照重置投影，保留浏览器本地输入状态。
 *
 * @param state - 当前状态。
 * @param snapshot - 服务端 Session 快照。
 * @returns 合并后的新状态。
 */
function hydrateState(state: SessionProjectionState, snapshot: SessionSnapshotDto): SessionProjectionState {
  if (
    state.loadState === 'ready' &&
    state.runtimeId === snapshot.runtime?.runtimeId &&
    state.epoch === snapshot.runtime?.epoch &&
    state.lastSequence > snapshot.sequence
  ) {
    return { ...state, error: undefined };
  }
  const { messages, tools, transcriptItems, turns } = projectPersistedTranscript(snapshot.messages);
  const runtimeState = snapshot.runtime?.state ?? 'dormant';
  const lastServerTimestamp =
    snapshot.generatedAt ??
    messages.reduce(
      (latest, message) => Math.max(latest, message.timestamp ?? 0, message.persistedAt ?? 0),
      0
    );
  const lastTurn = turns.at(-1);
  const activeTurnId = isActiveRuntimeState(runtimeState) ? lastTurn?.id : undefined;
  let activeRetryId: string | undefined;
  const turnsById = Object.fromEntries(
    turns.map((turn) => [
      turn.id,
      turn.id === activeTurnId
        ? restoreActiveRetry(
            { ...turn, status: 'running' as const, endedAt: undefined },
            snapshot.activeRetry,
            messages
          )
        : turn,
    ])
  );
  if (activeTurnId !== undefined && snapshot.activeRetry !== undefined) {
    activeRetryId = turnsById[activeTurnId]?.retries?.at(-1)?.id;
  }
  const feedbackByEntryId = new Map(
    (snapshot.messageFeedback ?? []).map((feedback) => [feedback.entryId, feedback.rating])
  );
  for (const message of messages) {
    if (message.entryId !== undefined && feedbackByEntryId.has(message.entryId)) {
      message.feedback = feedbackByEntryId.get(message.entryId);
    }
  }
  const hydrated: SessionProjectionState = {
    ...state,
    runtimeId: snapshot.runtime?.runtimeId,
    epoch: snapshot.runtime?.epoch,
    runtimeState,
    loadState: 'ready',
    lastSequence: snapshot.sequence,
    lastServerTimestamp,
    needsReconcile: false,
    hydrated: true,
    bufferedEvents: [],
    messageIds: messages.map((message) => message.id),
    messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
    pendingUserRequestIds: [],
    currentAssistantId: undefined,
    toolsById: Object.fromEntries(tools.map((tool) => [tool.id, tool])),
    toolIds: tools.map((tool) => tool.id),
    compactionsById: {},
    activeCompactionId: undefined,
    notificationsById: {},
    turnsById,
    activeTurnId,
    activeRetryId,
    transcriptItems,
    queue: { steering: [], followUp: [] },
    pendingExtensionUi: snapshot.pendingExtensionUi,
    subagentFleet: snapshot.subagentFleet,
    backgroundTasks: snapshot.backgroundTasks,
    goal: snapshot.goal,
    memory: snapshot.memory,
    contextUsage: snapshot.contextUsage,
    thinking: snapshot.thinking,
    permission: snapshot.permission ?? { mode: 'ask', scope: 'runtime-generation', persisted: false },
    planMode: snapshot.planMode,
    pendingWorkMode:
      state.runtimeId === snapshot.runtime?.runtimeId && state.epoch === snapshot.runtime?.epoch
        ? state.pendingWorkMode
        : undefined,
    error: undefined,
  };
  return state.bufferedEvents.reduce(reduceEvent, hydrated);
}

/**
 * Reconciles the Host's process-owned active retry with any trailing episode derived from durable messages.
 *
 * @param turn Latest persisted Turn owned by the running runtime.
 * @param activeRetry Host-cached retry metadata unavailable from Pi get_state.
 * @param messages Mutable normalized messages used to associate prior failures with the live episode.
 * @returns Running Turn carrying one active retry episode when metadata is available.
 */
function restoreActiveRetry(
  turn: SessionProjectionState['turnsById'][string],
  activeRetry: SessionSnapshotDto['activeRetry'],
  messages: MessageProjection[]
): SessionProjectionState['turnsById'][string] {
  if (activeRetry === undefined) {
    return turn;
  }
  const retries = [...(turn.retries ?? [])];
  const derived = retries.at(-1);
  const id = derived?.status === 'failed' ? derived.id : `retry-active-${turn.id}`;
  const scheduledAt = Date.parse(activeRetry.scheduledAt);
  const projection = {
    id,
    status: activeRetry.phase,
    attempt: activeRetry.attempt,
    maxAttempts: activeRetry.maxAttempts,
    delayMs: activeRetry.delayMs,
    errorMessage: activeRetry.errorMessage,
    scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : turn.startedAt,
  };
  if (derived?.status === 'failed') {
    retries[retries.length - 1] = projection;
  } else {
    retries.push(projection);
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') {
      break;
    }
    if (message.role === 'assistant' && message.stopReason === 'error') {
      messages[index] = { ...message, retryId: id };
    }
  }
  return { ...turn, retries };
}

/**
 * Appends a pending user message so the submitted prompt is visible before Pi emits its authoritative event.
 *
 * @param state - Current Session projection.
 * @param requestId - Client command identity used to keep the optimistic row unique.
 * @param text - Submitted user text.
 * @returns Projection containing the pending message and a cleared Composer.
 */
function appendOptimisticUserMessage(
  state: SessionProjectionState,
  requestId: string,
  text: string
): SessionProjectionState {
  const startedAt = Date.now();
  const message: MessageProjection = {
    id: `local-${requestId}`,
    role: 'user',
    content: [{ type: 'text', text }],
    correlationRequestId: requestId,
    timestamp: startedAt,
  };
  const turnId = `turn-request-${requestId}`;
  return {
    ...state,
    runtimeState: state.runtimeState === 'idle' ? 'starting' : state.runtimeState,
    messageIds: [...state.messageIds, message.id],
    messagesById: { ...state.messagesById, [message.id]: message },
    turnsById: {
      ...completeActiveTurn(state, startedAt),
      [turnId]: {
        id: turnId,
        startedByMessageId: message.id,
        startedAt,
        status: 'running',
      },
    },
    activeTurnId: turnId,
    transcriptItems: [...state.transcriptItems, { type: 'message', id: message.id, turnId }],
    pendingUserRequestIds: [...state.pendingUserRequestIds, requestId],
    draft: '',
    error: undefined,
  };
}

/**
 * Record acceptance without dropping optimistic reconciliation; idle confirmation ends its own turn.
 */
function acknowledgeUserCommand(
  state: SessionProjectionState,
  requestId: string,
  completion?: CommandAckMessage['completion']
): SessionProjectionState {
  if (completion && (state.runtimeId !== completion.runtimeId || state.epoch !== completion.epoch)) {
    return state;
  }
  const pendingUserRequestIds = state.pendingUserRequestIds.filter((id) => id !== requestId);
  if (!completion) {
    const localId = `local-${requestId}`;
    const local = state.messagesById[localId];
    if (!local || local.commandAcknowledged) {
      return state;
    }
    return {
      ...state,
      messagesById: {
        ...state.messagesById,
        [localId]: { ...local, commandAcknowledged: true },
      },
    };
  }
  const endedAt = Date.parse(completion.timestamp);
  if (!Number.isFinite(endedAt)) {
    return state;
  }
  const turn = Object.values(state.turnsById).find(
    (candidate) => state.messagesById[candidate.startedByMessageId]?.correlationRequestId === requestId
  );
  const ownsActiveTurn = turn !== undefined && state.activeTurnId === turn.id;
  return {
    ...state,
    ...(turn === undefined
      ? {}
      : {
          turnsById: {
            ...state.turnsById,
            [turn.id]: { ...turn, status: 'completed' as const, endedAt: turn.endedAt ?? endedAt },
          },
        }),
    activeTurnId: ownsActiveTurn ? undefined : state.activeTurnId,
    runtimeState: ownsActiveTurn && state.runtimeState === 'starting' ? 'idle' : state.runtimeState,
    pendingUserRequestIds,
  };
}

/**
 * Removes one rejected local prompt and restores its text when the user has not started another draft.
 *
 * @param state Current Session projection.
 * @param requestId Rejected command identity.
 * @param error Public transport error.
 * @returns Projection without the rejected optimistic row.
 */
function rejectOptimisticUserMessage(
  state: SessionProjectionState,
  requestId: string,
  error: string
): SessionProjectionState {
  const messageId = state.messageIds.find(
    (id) => state.messagesById[id]?.correlationRequestId === requestId && id.startsWith('local-')
  );
  if (messageId === undefined) {
    return { ...state, error };
  }
  const message = state.messagesById[messageId];
  const text = message?.content.find((block) => block.type === 'text')?.text ?? '';
  const messagesById = { ...state.messagesById };
  delete messagesById[messageId];
  const turnItem = state.transcriptItems.find((item) => item.type === 'message' && item.id === messageId);
  const turnId = turnItem !== undefined && 'turnId' in turnItem ? turnItem.turnId : undefined;
  const turnsById = { ...state.turnsById };
  if (turnId !== undefined) {
    delete turnsById[turnId];
  }
  return {
    ...state,
    runtimeState: state.runtimeState === 'starting' ? 'idle' : state.runtimeState,
    messageIds: state.messageIds.filter((id) => id !== messageId),
    messagesById,
    turnsById,
    activeTurnId: state.activeTurnId === turnId ? undefined : state.activeTurnId,
    transcriptItems: state.transcriptItems.filter((item) => item.type !== 'message' || item.id !== messageId),
    pendingUserRequestIds: state.pendingUserRequestIds.filter((candidate) => candidate !== requestId),
    draft: state.draft === '' ? text : state.draft,
    error,
  };
}

/**
 * Finalizes the current Turn before a newly submitted user message becomes authoritative.
 */
function completeActiveTurn(
  state: SessionProjectionState,
  fallbackEndedAt: number
): SessionProjectionState['turnsById'] {
  if (state.activeTurnId === undefined) {
    return state.turnsById;
  }
  const active = state.turnsById[state.activeTurnId];
  if (active === undefined) {
    return state.turnsById;
  }
  return {
    ...state.turnsById,
    [active.id]: {
      ...active,
      status: 'completed',
      endedAt: active.endedAt ?? fallbackEndedAt,
    },
  };
}

/**
 * Identifies snapshots whose latest persisted Turn is still owned by the live runtime.
 */
function isActiveRuntimeState(state: SessionProjectionState['runtimeState']): boolean {
  return state === 'starting' || state === 'running' || state === 'recovering' || state === 'stopping';
}
