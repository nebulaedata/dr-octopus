/**
 * @author Codex
 * @description Defines aggregate Session snapshot and bootstrap response contracts.
 */
import type { MemoryRuntimeSnapshot } from './memory.js';
import type { BackgroundTasksSnapshot } from './background-tasks.js';

import type { MessageFeedbackDto } from './feedback.js';
import type { GoalStateDto } from './goals.js';
import type { HostEventEnvelope } from './realtime.js';
import type { ActiveAutoRetryDto } from './retries.js';
import type {
  CommandDto,
  ContextUsageDto,
  ModelDto,
  PermissionStateDto,
  PlanModeStateDto,
  ThinkingStateDto,
} from './runtime.js';
import type { SessionDto, SessionRuntimeDto } from './sessions.js';
import type { SubagentFleetSnapshotDto } from './subagents.js';

/**
 * Persisted display-only history; carries no runtime identity or readiness.
 */
export interface SessionHistoryDto {
  sessionId: string;
  messages: unknown[];
  messageFeedback: MessageFeedbackDto[];
}

export interface SessionSnapshotDto {
  session: SessionDto;
  thinking: ThinkingStateDto;
  permission: PermissionStateDto;
  runtime?: SessionRuntimeDto;
  sequence: number;
  cursor?: string;
  state?: unknown;
  /**
   * Server-clock timestamp (epoch ms) when this snapshot was generated.
   * Seeds the client's `lastServerTimestamp` so running projections can resume
   * authoritative elapsed-time interpolation after reload or reconnect.
   */
  generatedAt: number;
  contextUsage?: ContextUsageDto;
  messages: unknown[];
  messageFeedback?: MessageFeedbackDto[];
  pendingExtensionUi: HostEventEnvelope[];
  activeRetry?: ActiveAutoRetryDto;
  subagentFleet?: SubagentFleetSnapshotDto;
  backgroundTasks?: BackgroundTasksSnapshot | null;
  goal?: GoalStateDto;
  memory?: MemoryRuntimeSnapshot;
  planMode: PlanModeStateDto;
}

export interface SessionBootstrapDto extends SessionSnapshotDto {
  readiness: {
    ready: true;
    runtimeId: string;
    epoch: number;
    resources: 'ready';
  };
  commands: CommandDto[];
  models: ModelDto[];
}
