/**
 * @author Codex
 * @description Defines scheduled-task HTTP operations with caller-owned retry-stable mutation keys.
 */
import { request } from '../utils/request';
import type {
  TaskAuthorizationApproval,
  TaskAuthorizationPreview,
  ScheduledTask,
  ScheduledMutation,
  ScheduledTaskPatch,
  ScheduledTaskQuery,
  ScheduledHistoryQuery,
  ScheduledHistoryRun,
} from '@octopus/shared/protocol/scheduled-tasks';

export interface ScheduleMutationInput {
  key: string;
  operation:
    | 'update'
    | 'delete'
    | 'archive'
    | 'restore'
    | 'purge'
    | 'run-now'
    | 'cancel'
    | 'authorize'
    | 'revoke-authorization';
  taskId?: string;
  revision?: number;
  input?: ScheduledTaskPatch | TaskAuthorizationApproval | { runId: string };
}

export type SchedulerServiceStatus =
  | { state: 'absent' }
  | { state: 'stopped' }
  | { state: 'unavailable' }
  | {
      state: 'control-ready';
      taskControlReady: true;
      executionReady: boolean;
      active: boolean;
      degraded: boolean;
      lastScanAt: string | null;
      queued: number;
      running: number;
      nextRunAt: string | null;
    };

export type SchedulerServiceAction = 'start' | 'stop' | 'restart';

export interface SchedulerSettings {
  timezone: string;
  maxConcurrentRuns: number;
  revision: number;
  updatedAt: string;
}

/**
 * Reads the shared Scheduler daemon lifecycle and execution diagnostics.
 */
export function getSchedulerServiceStatus(signal?: AbortSignal): Promise<SchedulerServiceStatus> {
  return request({ url: '/scheduler/service', signal });
}

/**
 * Applies one explicit lifecycle action to the shared Scheduler daemon.
 */
export function controlSchedulerService(action: SchedulerServiceAction): Promise<SchedulerServiceStatus> {
  return request({ url: `/scheduler/service/${action}`, method: 'POST' });
}

/**
 * Reads the Agent-owned cron.json configuration.
 */
export function getSchedulerSettings(signal?: AbortSignal): Promise<SchedulerSettings> {
  return request({ url: '/scheduler/settings', signal });
}

/**
 * Replaces Scheduler configuration at the caller's observed revision.
 */
export function updateSchedulerSettings(input: {
  timezone: string;
  maxConcurrentRuns: number;
  revision: number;
}): Promise<SchedulerSettings> {
  return request({ url: '/scheduler/settings', method: 'PUT', data: input });
}

/**
 * Reads one globally paginated catalog, optionally restricted to a workspace.
 */
export function getScheduledTaskCatalog(
  filters: Partial<ScheduledTaskQuery> & { workspaceId?: string },
  signal?: AbortSignal
): Promise<{ items: ScheduledTask[] }> {
  return request({
    url: '/scheduled-tasks',
    params: filters,
    signal,
  });
}

/**
 * Reads the current task independently of catalog pagination and filters.
 */
export function getScheduledTask(
  workspaceId: string,
  taskId: string,
  signal?: AbortSignal
): Promise<ScheduledTask> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/scheduled-tasks/${encodeURIComponent(taskId)}`,
    signal,
  });
}

/**
 * Reads run history only for the selected task.
 */
export function getScheduledRuns(
  workspaceId: string,
  taskId: string,
  signal?: AbortSignal,
  filters: Partial<ScheduledHistoryQuery> = {}
): Promise<{ items: ScheduledHistoryRun[] }> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/scheduled-tasks/${encodeURIComponent(taskId)}/runs`,
    params: { limit: 20, ...filters },
    signal,
  });
}

/**
 * Search every retained run in a Workspace, including archived task history.
 */
export function searchScheduledHistory(
  workspaceId: string,
  filters: Partial<ScheduledHistoryQuery>,
  signal?: AbortSignal
): Promise<{ items: (ScheduledHistoryRun & { workspaceId: string; workspaceName: string })[] }> {
  return request({
    url: '/scheduled-tasks/history',
    params: { limit: 20, ...filters, ...(workspaceId ? { workspaceId } : {}) },
    signal,
  });
}

/**
 * Shares the logical request key across network retries and sends revision preconditions on edits.
 */
export function mutateScheduledTask(
  workspaceId: string,
  input: ScheduleMutationInput
): Promise<ScheduledMutation> {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  /**
   * Selects path in the existing condition order.
   */
  function selectPath() {
    if (input.operation === 'run-now') {
      return '/runs' as const;
    } else if (input.operation === 'cancel') {
      return '/cancel' as const;
    } else if (
      ['archive', 'restore', 'purge', 'authorize', 'revoke-authorization'].includes(input.operation)
    ) {
      return `/${input.operation}`;
    } else {
      return '' as const;
    }
  }
  const path = `${base}/scheduled-tasks/${encodeURIComponent(input.taskId!)}${selectPath()}`;
  /**
   * Selects method in the existing condition order.
   */
  function selectMethod() {
    if (input.operation === 'delete') {
      return 'DELETE' as const;
    } else if (input.operation === 'update') {
      return 'PATCH' as const;
    } else {
      return 'POST' as const;
    }
  }
  return request({
    url: path,
    timeout: ['authorize', 'revoke-authorization', 'restore', 'purge'].includes(input.operation)
      ? 65_000
      : 20_000,
    method: selectMethod(),
    headers: {
      'Idempotency-Key': input.key,
      ...(input.revision ? { 'If-Match': `"${input.revision}"` } : {}),
    },
    data: input.input ?? {},
  });
}

/**
 * Inspect tool capabilities without running the scheduled prompt.
 */
export function previewTaskAuthorization(
  workspaceId: string,
  taskId: string,
  signal?: AbortSignal
): Promise<TaskAuthorizationPreview> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/scheduled-tasks/${encodeURIComponent(taskId)}/authorization-preview`,
    method: 'POST',
    signal,
    timeout: 65_000,
  });
}

/**
 * Read the isolated execution artifact without creating a Runtime or executing the task again.
 */
export function getScheduledTranscript(
  workspaceId: string,
  taskId: string,
  runId: string,
  signal?: AbortSignal
): Promise<{ runId: string; entries: { role: string; text: string }[]; truncated: boolean }> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/scheduled-tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}/transcript`,
    signal,
  });
}
