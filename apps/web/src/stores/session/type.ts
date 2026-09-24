/**
 * @author Codex
 * @description Defines normalized browser projections and the imperative Session Store contract.
 */
import type { MemoryRuntimeSnapshot } from '@octopus/shared/protocol/memory';
import type { TokenUsage } from './utils/token-usage';

import type { StoreApi } from 'zustand/vanilla';
import type {
  CommandAckMessage,
  ContextUsageDto,
  HostEventEnvelope,
  GoalStateDto,
  PlanModeStateDto,
  PermissionStateDto,
  RuntimeProjectionState,
  SessionSnapshotDto,
  SessionHistoryDto,
  SubagentFleetSnapshotDto,
  BackgroundTasksSnapshot,
  ThinkingStateDto,
} from '@octopus/shared/protocol';
import type {
  DocumentCoverageV1,
  AttachmentErrorCode,
  AttachmentPresentationKind,
  MessageAttachmentDto,
} from '@octopus/shared/protocol/attachments';

export interface ComposerAttachmentViewModel {
  coverage?: DocumentCoverageV1;
  id: string;
  localKey?: string;
  uploadFingerprint?: string;
  name: string;
  byteSize: number;
  detectedMediaType?: string;
  presentationKind?: AttachmentPresentationKind;
  revision: number;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'rejected' | 'deleted';
  progress?: { uploadedBytes: number; totalBytes: number; percentage: number };
  error?: { code: AttachmentErrorCode | 'UPLOAD_SOURCE_REQUIRED'; message: string; retryable: boolean };
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'file'; name: string; size: number; mimeType: string; data: string };

export type ToolContentBlock =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolProjection {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  arguments?: unknown;
  content: ToolContentBlock[];
  details?: unknown;
  usage?: unknown;
  addedToolNames?: string[];
  terminate?: boolean;
  startedAt: number;
  endedAt?: number;
}

export interface CompactionProjection {
  id: string;
  status: 'running' | 'success' | 'error' | 'aborted';
  reason: 'manual' | 'threshold' | 'overflow';
  startedAt: number;
  endedAt?: number;
  errorMessage?: string;
}

export interface ExtensionNotificationProjection {
  id: string;
  message: string;
  notifyType?: string;
  requestId?: string;
  timestamp: number;
}

export interface AutoRetryProjection {
  id: string;
  status: 'waiting' | 'retrying' | 'succeeded' | 'failed';
  attempt: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage: string;
  finalError?: string;
  scheduledAt: number;
  endedAt?: number;
}

export interface TurnProjection {
  id: string;
  startedByMessageId: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed';
  retries?: AutoRetryProjection[];
}

export type TranscriptItem =
  | { type: 'message'; id: string; turnId?: string }
  | { type: 'tool'; id: string; turnId?: string }
  | { type: 'compaction'; id: string }
  | { type: 'notification'; id: string; turnId?: string };

export interface MessageProjection {
  tokenUsage?: TokenUsage;
  id: string;
  role: 'user' | 'assistant' | 'toolResult' | 'system' | 'custom';
  customType?: string;
  content: ContentBlock[];
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  correlationRequestId?: string;
  /**
   * The local command was accepted but may still be waiting for Agent settlement.
   */
  commandAcknowledged?: true;
  timestamp?: number;
  persistedAt?: number;
  entryId?: string;
  feedback?: 'up' | 'down';
  stopReason?: string;
  errorMessage?: string;
  retryId?: string;
  interrupted?: boolean;
  attachments?: MessageAttachmentDto[];
}

export interface SessionProjectionState {
  sessionId: string;
  loadState: 'uninitialized' | 'loading' | 'ready' | 'error';
  runtimeId?: string;
  epoch?: number;
  runtimeState: RuntimeProjectionState;
  lastSequence: number;
  /**
   * Latest Server-clock timestamp (epoch ms) observed from event envelopes or the
   * hydration snapshot. Anchors authoritative elapsed-time derivation for running
   * projections without ever mixing the browser wall clock into the Server domain.
   */
  lastServerTimestamp: number;
  needsReconcile: boolean;
  /**
   * Whether the first authoritative snapshot has been hydrated.
   * Used to present loading skeletons before any data is available.
   */
  hydrated: boolean;
  /**
   * Whether persisted history is visible independently of live hydration.
   */
  historyLoaded: boolean;
  bufferedEvents: HostEventEnvelope[];
  messageIds: string[];
  messagesById: Record<string, MessageProjection>;
  pendingUserRequestIds: string[];
  currentAssistantId?: string;
  toolsById: Record<string, ToolProjection>;
  toolIds: string[];
  compactionsById: Record<string, CompactionProjection>;
  activeCompactionId?: string;
  notificationsById: Record<string, ExtensionNotificationProjection>;
  turnsById: Record<string, TurnProjection>;
  activeTurnId?: string;
  activeRetryId?: string;
  transcriptItems: TranscriptItem[];
  queue: { steering: unknown[]; followUp: unknown[] };
  pendingExtensionUi: HostEventEnvelope[];
  subagentFleet?: SubagentFleetSnapshotDto;
  backgroundTasks?: BackgroundTasksSnapshot | null;
  goal?: GoalStateDto;
  memory?: MemoryRuntimeSnapshot;
  draft: string;
  attachments: ComposerAttachmentViewModel[];
  contextUsage?: ContextUsageDto;
  thinking: ThinkingStateDto;
  permission: PermissionStateDto;
  planMode: PlanModeStateDto;
  pendingWorkMode?: { requestId: string; mode: PlanModeStateDto['workMode'] };
  error?: string;
}

/**
 * Imperative actions that mutate the Session projection.
 */
export interface SessionActions {
  /**
   * Starts a fresh route bootstrap while preserving browser-owned draft state.
   */
  beginBootstrap(): void;
  /**
   * Applies one authoritative snapshot while preserving browser-owned draft state.
   */
  hydrate(snapshot: SessionSnapshotDto): void;
  /**
   * Displays persisted history without authorizing runtime operations.
   */
  previewHistory(history: SessionHistoryDto): void;
  /**
   * Marks the current bootstrap attempt as failed.
   */
  failBootstrap(error: string): void;
  /**
   * Merges one ordered realtime event.
   */
  applyEvent(event: HostEventEnvelope): void;
  /**
   * Adds one pending user message that will be replaced by its authoritative runtime projection.
   */
  appendOptimisticUserMessage(requestId: string, text: string): void;
  /**
   * Rolls back a transport-rejected optimistic prompt and restores its draft text.
   */
  rejectOptimisticUserMessage(requestId: string, error: string): void;
  /**
   * Accepts a command and, when supplied, applies its generation-fenced completion.
   */
  acknowledgeUserCommand(requestId: string, completion?: CommandAckMessage['completion']): void;
  /**
   * Updates the Composer draft.
   */
  setDraft(draft: string): void;
  /**
   * Replaces pending browser attachments.
   */
  setAttachments(attachments: ComposerAttachmentViewModel[]): void;
  /**
   * Replaces thinking controls with Pi's effective command result.
   */
  setThinking(thinking: ThinkingStateDto): void;
  /**
   * Replaces permission controls with the Agent's authoritative runtime-generation state.
   */
  setPermission(permission: PermissionStateDto): void;
  /**
   * Starts one fenced Agent/Plan control mutation without changing the effective mode optimistically.
   */
  beginWorkModeChange(requestId: string, mode: PlanModeStateDto['workMode']): void;
  /**
   * Applies the Server-confirmed Plan workflow projection and settles the pending mutation.
   */
  setPlanMode(planMode: PlanModeStateDto, requestId?: string): void;
  /**
   * Rejects only the matching work-mode mutation and retains the last authoritative state.
   */
  rejectWorkModeChange(requestId: string, error: string): void;
  /**
   * Updates the visible Session error.
   */
  setError(error?: string): void;
}

export type SessionStore = SessionProjectionState & SessionActions;

export type SessionStoreApi = StoreApi<SessionStore>;

/**
 * Configuration for SessionStoreRegistry idle reclamation.
 */
export interface SessionStoreRegistryOptions {
  /**
   * Time in milliseconds before an idle store is eligible for cleanup.
   */
  idleTtlMs?: number;
  /**
   * Maximum number of stores to retain; excess idle stores are reclaimed by LRU.
   */
  maxStores?: number;
}
