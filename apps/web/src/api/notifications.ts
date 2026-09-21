/**
 * @author Codex
 * @description Reads durable completion notices and acknowledges observed Session versions.
 */
import { request } from '@/utils/request';
import type { SessionDto } from '@octopus/shared/protocol';
import type { ScheduledRun } from '@octopus/shared/protocol/scheduled-tasks';
export interface SessionNotice {
  id: number;
  workspaceId: string;
  sessionId: string;
  originSessionId: string | null;
  taskId: string | null;
  runId: string | null;
  title: string;
  summary: string;
  status: string;
  createdAt: string;
  unread: boolean;
}
/**
 * Load one global or source-scoped page without activating a runtime.
 */
export function getNotifications(
  offset = 0,
  sessionId?: string,
  signal?: AbortSignal
): Promise<{ items: SessionNotice[]; hasMore: boolean; unreadCount: number }> {
  const query = new URLSearchParams({ offset: String(offset), ...(sessionId ? { sessionId } : {}) });
  return request({ url: `/notifications?${query}`, method: 'GET', signal });
}
/**
 * Mark existing notifications across all pages and workspaces as read.
 */
export function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  return request({ url: '/notifications/read-all', method: 'POST' });
}

/**
 * Acknowledge only what the focused page has successfully displayed.
 */
export function markSessionRead(
  workspaceId: string,
  sessionId: string,
  version: number
): Promise<{ ok: boolean }> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/read`,
    method: 'POST',
    data: { version },
  });
}

/**
 * Resolve a retained run to its registered result Session without executing it.
 */
export function resolveRunSession(
  workspaceId: string,
  taskId: string,
  runId: string
): Promise<{ workspaceId: string; sessionId: string }> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/scheduled-tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}/session`,
    method: 'GET',
  });
}
/**
 * Read the most recent execution entries with an explicit older-page offset.
 */
export function getExecutionSession(
  workspaceId: string,
  sessionId: string,
  offset: number,
  signal?: AbortSignal
): Promise<{
  session: SessionDto;
  run: ScheduledRun;
  prompt: string;
  items: { id: string; role: string; text: string }[];
  hasMore: boolean;
}> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/execution?offset=${offset}`,
    method: 'GET',
    signal,
  });
}
