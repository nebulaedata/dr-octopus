/**
 * @author Codex
 * @description Defensively projects Agent Scheduler tool details into bounded Web presentation records.
 */

import { isRecord, readString } from '../tool-renderer-utils';
import type { Translate } from '@/i18n/use-i18n';
import type { ToolProjection } from '@/stores/session';

export interface SchedulerScheduleProjection {
  type: 'once' | 'interval' | 'cron';
  primary: string;
  secondary?: string;
}

export interface SchedulerTaskProjection {
  id?: string;
  name?: string;
  description?: string;
  prompt?: string;
  enabled?: boolean;
  revision?: number;
  nextRunAt?: string | null;
  pausedAt?: string | null;
  schedule?: SchedulerScheduleProjection;
}

export interface SchedulerRunProjection {
  id?: string;
  taskId?: string;
  status?: string;
  triggerSource?: string;
  scheduledFor?: string;
  startedAt?: string | null;
  settledAt?: string | null;
  summary?: string | null;
  errorCode?: string | null;
}

export interface SchedulerToolProjection {
  effect?: string;
  task?: SchedulerTaskProjection;
  tasks: SchedulerTaskProjection[];
  run?: SchedulerRunProjection;
  runs: SchedulerRunProjection[];
  warnings: string[];
  offset?: number;
  requestedTaskId?: string;
  requestedRunId?: string;
}

/**
 * Projects one Scheduler tool from structured result details and safe argument previews.
 *
 * @param t Active translation function from `useI18n`.
 * @param tool Browser Tool projection.
 * @returns Bounded fields used by the Scheduler card.
 */
export function projectSchedulerTool(t: Translate, tool: ToolProjection): SchedulerToolProjection {
  const details = isRecord(tool.details) ? tool.details : {};
  const args = isRecord(tool.arguments) ? tool.arguments : {};
  const detailTask = isRecord(details['task'])
    ? projectTask(t, details['task'])
    : looksLikeTask(details)
      ? projectTask(t, details)
      : undefined;
  const argumentTask = tool.name === 'scheduler_create' ? projectTask(t, args) : undefined;
  const task = detailTask ?? argumentTask;
  const items = Array.isArray(details['items']) ? details['items'].slice(0, 100) : [];
  const tasks = tool.name === 'scheduler_list' ? items.map((item) => projectTask(t, item)).filter(hasTaskIdentity) : [];
  const runs = tool.name === 'scheduler_history' ? items.map(projectRun).filter(hasRunIdentity) : [];
  const run = isRecord(details['run']) ? projectRun(details['run']) : undefined;
  const warnings = Array.isArray(details['warnings'])
    ? details['warnings'].flatMap((value) => (typeof value === 'string' ? [value.slice(0, 500)] : []))
    : [];
  return {
    ...(readString(details, 'effect') === undefined ? {} : { effect: readString(details, 'effect') }),
    ...(task === undefined ? {} : { task }),
    tasks,
    ...(run === undefined ? {} : { run }),
    runs,
    warnings,
    ...readNumber(details, 'offset', 'offset'),
    ...(readString(args, 'taskId') === undefined ? {} : { requestedTaskId: readString(args, 'taskId') }),
    ...(readString(args, 'runId') === undefined ? {} : { requestedRunId: readString(args, 'runId') }),
  };
}

/**
 * Builds a compact collapsed-card label from structured Scheduler details.
 *
 * @param tool Browser Tool projection.
 * @param t Active translation function from `useI18n`.
 * @returns Task name, collection size, or requested identifier.
 */
export function summarizeSchedulerTool(tool: ToolProjection, t: Translate): string | undefined {
  const projection = projectSchedulerTool(t, tool);
  if (tool.name === 'scheduler_list') {
    return t('session.schedulerProjection.tasksCount', '{{count}} tasks', { count: projection.tasks.length });
  }
  if (tool.name === 'scheduler_history') {
    return t('session.schedulerProjection.runsCount', '{{count}} runs', { count: projection.runs.length });
  }
  return (
    projection.task?.name ??
    readString(tool.arguments, 'name') ??
    projection.requestedTaskId ??
    projection.requestedRunId
  );
}

/**
 * Reads the stable task fields rendered by Scheduler cards.
 */
function projectTask(t: Translate, value: unknown): SchedulerTaskProjection {
  const record = isRecord(value) ? value : {};
  const schedule = projectSchedule(t, record['schedule']);
  return {
    ...readOptionalString(record, 'id'),
    ...readOptionalString(record, 'name'),
    ...readOptionalString(record, 'description'),
    ...readOptionalString(record, 'prompt'),
    ...(typeof record['enabled'] === 'boolean' ? { enabled: record['enabled'] } : {}),
    ...readNumber(record, 'revision', 'revision'),
    ...readNullableString(record, 'nextRunAt', 'nextRunAt'),
    ...readNullableString(record, 'pausedAt', 'pausedAt'),
    ...(schedule === undefined ? {} : { schedule }),
  };
}

/**
 * Reads one bounded run result without trusting extension payload shape.
 */
function projectRun(value: unknown): SchedulerRunProjection {
  const record = isRecord(value) ? value : {};
  return {
    ...readOptionalString(record, 'id'),
    ...readOptionalString(record, 'taskId'),
    ...readOptionalString(record, 'status'),
    ...readOptionalString(record, 'triggerSource'),
    ...readOptionalString(record, 'scheduledFor'),
    ...readNullableString(record, 'startedAt', 'startedAt'),
    ...readNullableString(record, 'settledAt', 'settledAt'),
    ...readNullableString(record, 'summary', 'summary'),
    ...readNullableString(record, 'errorCode', 'errorCode'),
  };
}

/**
 * Formats supported schedule variants into primary and secondary display lines.
 */
function projectSchedule(t: Translate, value: unknown): SchedulerScheduleProjection | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value['type'] === 'once') {
    const at = readString(value, 'at');
    return at === undefined
      ? undefined
      : { type: 'once', primary: t('session.schedulerProjection.onceTask', 'One-time task'), secondary: at };
  }
  if (value['type'] === 'cron') {
    const expression = readString(value, 'expression');
    const timezone = readString(value, 'timezone');
    return expression === undefined
      ? undefined
      : { type: 'cron', primary: expression, ...(timezone === undefined ? {} : { secondary: timezone }) };
  }
  if (value['type'] === 'interval' && typeof value['everyMs'] === 'number') {
    const anchorAt = readString(value, 'anchorAt');
    return {
      type: 'interval',
      primary: t('session.schedulerProjection.intervalEvery', 'Every {{interval}}', {
        interval: formatInterval(t, value['everyMs']),
      }),
      ...(anchorAt === undefined
        ? {}
        : { secondary: t('session.schedulerProjection.intervalAnchor', 'From {{at}}', { at: anchorAt }) }),
    };
  }
  return undefined;
}

/**
 * Formats a positive interval without losing sub-hour precision.
 */
function formatInterval(t: Translate, milliseconds: number): string {
  if (milliseconds % 86_400_000 === 0) {
    return t('session.schedulerProjection.intervalDays', '{{count}} days', {
      count: milliseconds / 86_400_000,
    });
  }
  if (milliseconds % 3_600_000 === 0) {
    return t('session.schedulerProjection.intervalHours', '{{count}} hours', {
      count: milliseconds / 3_600_000,
    });
  }
  if (milliseconds % 60_000 === 0) {
    return t('session.schedulerProjection.intervalMinutes', '{{count}} minutes', {
      count: milliseconds / 60_000,
    });
  }
  return t('session.schedulerProjection.intervalMs', '{{count}} ms', { count: milliseconds });
}

/**
 * Detects a direct task response without requiring every domain field.
 */
function looksLikeTask(value: Record<string, unknown>): boolean {
  return typeof value['id'] === 'string' && typeof value['name'] === 'string';
}

/**
 * Retains only collection task records with a stable identity.
 */
function hasTaskIdentity(value: SchedulerTaskProjection): boolean {
  return value.id !== undefined || value.name !== undefined;
}

/**
 * Retains only collection run records with a stable identity.
 */
function hasRunIdentity(value: SchedulerRunProjection): boolean {
  return value.id !== undefined || value.status !== undefined;
}

/**
 * Reads one bounded string into a same-name projection field.
 */
function readOptionalString<
  K extends 'id' | 'name' | 'description' | 'prompt' | 'taskId' | 'status' | 'triggerSource' | 'scheduledFor',
>(value: Record<string, unknown>, key: K): Partial<Record<K, string>> {
  const candidate = readString(value, key);
  return candidate === undefined
    ? {}
    : ({ [key]: candidate.slice(0, key === 'prompt' ? 4_000 : 500) } as Partial<Record<K, string>>);
}

/**
 * Reads one finite non-negative numeric field.
 */
function readNumber<T extends string>(
  value: Record<string, unknown>,
  source: string,
  target: T
): Partial<Record<T, number>> {
  const candidate = value[source];
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
    ? ({ [target]: candidate } as Partial<Record<T, number>>)
    : {};
}

/**
 * Reads a nullable timestamp or summary field.
 */
function readNullableString<T extends string>(
  value: Record<string, unknown>,
  source: string,
  target: T
): Partial<Record<T, string | null>> {
  const candidate = value[source];
  return candidate === null
    ? ({ [target]: null } as Partial<Record<T, null>>)
    : typeof candidate === 'string'
      ? ({ [target]: candidate.slice(0, 4_000) } as Partial<Record<T, string>>)
      : {};
}
