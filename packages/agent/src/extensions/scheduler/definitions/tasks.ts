/**
 * @author Codex
 * @description Host-independent scheduler task, run and caller-scope contracts without ORM types.
 */
import type {
  ScheduledTaskInput,
  ScheduledRun,
  TaskAuthorizationRef,
} from '@octopus/shared/protocol/scheduled-tasks';

export interface SchedulerTaskScope {
  workspaceId: string;
  originSessionRef?: string | null;
}

export interface SchedulerTaskContext extends SchedulerTaskScope {
  cwd: string;
  configRevision: string;
}

export interface SchedulerTaskRecord extends ScheduledTaskInput {
  hasActiveRun?: boolean;
  id: string;
  workspaceId: string;
  cwd: string;
  configRevision: string;
  originSessionRef: string | null;
  revision: number;
  authorizationRef: TaskAuthorizationRef | null;
  authorizationBlock: string | null;
  nextRunAt: string | null;
  pausedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerTask extends Omit<SchedulerTaskRecord, 'cwd' | 'configRevision'> {
  executionMode: 'isolated-run';
}

export interface SchedulerRun {
  id: string;
  taskId: string;
  status: ScheduledRun['status'];
  scheduledFor: string;
  triggerSource: 'schedule' | 'manual';
  cancelRequestedAt: string | null;
  startedAt: string | null;
  settledAt: string | null;
  summary: string | null;
  errorCode: string | null;
  createdAt: string;
}

export interface SchedulerTaskMutation {
  effect: 'saved' | 'deleted' | 'restored' | 'purged' | 'queued' | 'cancelled' | 'cancellation_requested';
  task: SchedulerTask;
  run?: SchedulerRun;
  warnings: string[];
}

export type SchedulerTaskMutationRequest = {
  operation: 'create' | 'update' | 'delete' | 'restore' | 'purge' | 'run-now' | 'cancel';
  key: string;
  taskId?: string;
  revision?: number;
  input: unknown;
};

export interface SchedulerPage<T> {
  items: T[];
  limit: number;
  offset: number;
}
