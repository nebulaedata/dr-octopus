/**
 * @author Codex
 * @description Defines and validates bounded session-owned background process observations.
 */
import { z } from 'zod';

export const BACKGROUND_STATUS_KEY = 'octopus-background';
export const BACKGROUND_COMMAND = 'octopus-background';
const taskSchema = z.object({
  taskId: z.string().uuid(),
  label: z.string().max(160),
  state: z.enum(['starting', 'running', 'stopping', 'stopped', 'exited', 'failed', 'unknown']),
  createdAt: z.number().finite(),
  endedAt: z.number().finite().optional(),
  exitCode: z.number().int().nullable().optional(),
  error: z.string().max(512).optional(),
});
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  accepting: z.boolean(),
  stopId: z.string().max(80).optional(),
  activeCount: z.number().int().min(0).max(8),
  tasks: z.array(taskSchema).max(108),
  error: z.string().max(512).optional(),
  logs: z
    .object({ taskId: z.string().uuid(), text: z.string().max(65536), truncated: z.boolean() })
    .optional(),
});
export type BackgroundTaskDto = z.infer<typeof taskSchema>;
export type BackgroundTasksSnapshot = z.infer<typeof snapshotSchema>;

/**
 * Unknown and unconfirmed stopping tasks retain ownership and block reclamation.
 */
export function isBackgroundTaskActive(task: BackgroundTaskDto): boolean {
  return ['starting', 'running', 'stopping', 'unknown'].includes(task.state);
}

/**
 * Rejects incomplete or inconsistent observations rather than trusting a claimed empty scope.
 */
export function parseBackgroundTasks(value: unknown): BackgroundTasksSnapshot | undefined {
  const result = snapshotSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }
  const snapshot = result.data;
  if (snapshot.activeCount !== snapshot.tasks.filter(isBackgroundTaskActive).length) {
    return undefined;
  }
  if (new Set(snapshot.tasks.map((task) => task.taskId)).size !== snapshot.tasks.length) {
    return undefined;
  }
  return snapshot;
}

/**
 * Reads the extension status transport; null explicitly denotes a broken matching observation.
 */
export function projectBackgroundTasks(payload: unknown): BackgroundTasksSnapshot | null | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record['method'] !== 'setStatus' || record['statusKey'] !== BACKGROUND_STATUS_KEY) {
    return undefined;
  }
  if (typeof record['statusText'] !== 'string' || record['statusText'].length > 262144) {
    return null;
  }
  try {
    return parseBackgroundTasks(JSON.parse(record['statusText'])) ?? null;
  } catch {
    return null;
  }
}
