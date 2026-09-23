/**
 * @author Codex
 * @description Defines the bidirectional WebSocket protocol shared by Web and Server.
 */
import type { MemoryRuntimeSnapshot } from './memory.js';
import type { BackgroundTasksSnapshot } from './background-tasks.js';

import type { KnowledgeModeConfig } from './knowledge/mode.js';
import type { GoalStateDto } from './goals.js';
import type {
  OCTOPUS_PROTOCOL_VERSION,
  PermissionMode,
  PermissionStateDto,
  PlanModeStateDto,
  RuntimeWorkMode,
  ThinkingLevel,
  ThinkingStateDto,
} from './runtime.js';
import type { SessionRuntimeDto } from './sessions.js';
import type { WorkspaceReferenceDto } from './workspace-references.js';

export interface UserMessagePayload {
  message: string;
  attachmentIds?: string[];
  workspaceReferences?: WorkspaceReferenceDto[];
}

export interface HostEventEnvelope<T = unknown> {
  type:
    'agent.event' | 'agent.lifecycle' | 'agent.state' | 'agent.health' | 'extension.ui' | 'subagents.state';
  requestId?: string;
  runtimeId: string;
  epoch: number;
  workspaceId: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  payload: T;
  /**
   * Latest server-validated pi-goal state when this event crosses a Goal state boundary.
   */
  goal?: GoalStateDto | null;
  memory?: MemoryRuntimeSnapshot | null;
  backgroundTasks?: BackgroundTasksSnapshot | null;
  /**
   * Latest server-validated pi-plan-mode state when this event crosses a Plan state boundary.
   */
  planMode?: PlanModeStateDto;
}

export interface ConnectionReadyMessage {
  type: 'connection.ready';
  protocolVersion: typeof OCTOPUS_PROTOCOL_VERSION;
  connectionId: string;
}

export interface CommandAckMessage {
  type: 'command.ack';
  requestId: string;
  sessionId?: string;
  thinking?: ThinkingStateDto;
  permission?: PermissionStateDto;
  planMode?: PlanModeStateDto;
  /**
   * Present only after an accepted prompt is observed idle with no compaction or queued messages.
   * Plain acknowledgements remain acceptance, not completion.
   */
  completion?: { runtimeId: string; epoch: number; timestamp: string };
}

export interface ProtocolErrorMessage {
  type: 'error';
  requestId?: string;
  code: string;
  message: string;
  retryable?: boolean;
}

export interface SessionSubscribedMessage {
  type: 'session.subscribed' | 'session.unsubscribed';
  requestId: string;
  sessionId: string;
  runtime?: SessionRuntimeDto;
}

export type ServerRealtimeMessage =
  | ConnectionReadyMessage
  | CommandAckMessage
  | ProtocolErrorMessage
  | SessionSubscribedMessage
  | HostEventEnvelope
  | { type: 'pong'; requestId: string; timestamp: string };

export interface SessionTarget {
  sessionId: string;
  runtimeId?: string;
  epoch?: number;
}

export type ClientRealtimeMessage =
  | { type: 'ping'; requestId: string }
  | { type: 'session.focus'; requestId: string; sessionId: string | null }
  | ({ type: 'session.subscribe' | 'session.unsubscribe'; requestId: string } & SessionTarget)
  | ({
      type: 'agent.prompt';
      requestId: string;
      payload: UserMessagePayload;
    } & SessionTarget)
  | ({
      type: 'agent.steer' | 'agent.follow-up';
      requestId: string;
      payload: UserMessagePayload;
    } & SessionTarget)
  | ({ type: 'agent.abort' | 'agent.compact' | 'agent.abort-retry'; requestId: string } & SessionTarget)
  | ({
      type: 'agent.set-model';
      requestId: string;
      payload: { provider: string; modelId: string };
    } & SessionTarget)
  | ({ type: 'agent.set-thinking'; requestId: string; payload: { level: ThinkingLevel } } & SessionTarget)
  | ({
      type: 'agent.set-work-mode';
      requestId: string;
      payload: { mode: RuntimeWorkMode; knowledge?: KnowledgeModeConfig };
    } & SessionTarget)
  | ({
      type: 'agent.set-permission-mode';
      requestId: string;
      payload: { mode: PermissionMode };
    } & SessionTarget)
  | ({
      type: 'agent.set-queue-mode';
      requestId: string;
      payload: { queue: 'steering' | 'follow-up'; mode: 'all' | 'one-at-a-time' };
    } & SessionTarget)
  | ({
      type: 'extension.ui.response';
      requestId: string;
      payload: { extensionRequestId: string; value?: string; confirmed?: boolean; cancelled?: true };
    } & SessionTarget);
