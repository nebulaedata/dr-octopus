/**
 * @author Codex
 * @description Scheduler execution work, runner evidence and terminal outcome contracts.
 */
import type { TaskAuthorizationRef, ScheduledRun } from '@octopus/shared/protocol/scheduled-tasks';

export interface SchedulerExecutionWork {
  authorizationRef?: TaskAuthorizationRef | null;
  runId: string;
  taskId: string;
  attemptId: string;
  workspaceId: string;
  cwd: string;
  originSessionRef: string | null;
  prompt: string;
  configRevision: string;
  timeoutMs: number;
  scheduledFor: string;
  timezone?: string;
  overlapPolicy: 'skip' | 'queue-one';
}

export interface SchedulerSessionEvidence {
  sessionId: string;
  sessionPath: string;
}

export interface SchedulerRunOutcome {
  status: Extract<
    ScheduledRun['status'],
    'succeeded' | 'failed' | 'needs_attention' | 'timed_out' | 'cancelled' | 'interrupted'
  >;
  summary: string;
  errorCode: string | null;
}

export interface SchedulerWorkDiagnostics {
  queued: number;
  running: number;
  nextRunAt: string | null;
}
