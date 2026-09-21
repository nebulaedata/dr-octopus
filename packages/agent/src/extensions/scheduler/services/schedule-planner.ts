/**
 * @author Codex
 * @description Computes explicit UTC schedule instants without clocks, timers, or persistence.
 */
import { Cron } from 'croner';
import { SchedulerTaskError } from '../definitions/task-error.js';
import type { Schedule } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Validates product cron syntax and timezone independently of the host timezone.
 */
function cron(schedule: Extract<Schedule, { type: 'cron' }>): Cron {
  try {
    if (/^[+-]/.test(schedule.timezone)) {
      throw new Error('Fixed offsets are not IANA zones.');
    }
    new Intl.DateTimeFormat('en', { timeZone: schedule.timezone });
  } catch {
    throw new SchedulerTaskError('SCHEDULE_TIMEZONE_INVALID', 'Invalid IANA timezone.');
  }
  if (
    schedule.expression.trim().split(/\s+/).length !== 5 ||
    !/^[\d\s*,/-]+$/.test(
      schedule.expression.replace(
        /(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT)/gi,
        '1'
      )
    )
  ) {
    throw new SchedulerTaskError('SCHEDULE_INVALID', 'Use a standard five-field Cron expression.');
  }
  try {
    return new Cron(schedule.expression, { timezone: schedule.timezone, paused: true });
  } catch {
    throw new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid Cron expression.');
  }
}

/**
 * Normalizes dates and validates Cron while preserving interval phase.
 */
export function normalizeSchedule(schedule: Schedule): Schedule {
  if (schedule.type === 'cron') {
    cron(schedule).stop();
    return { ...schedule, expression: schedule.expression.trim().replace(/\s+/g, ' ').toUpperCase() };
  }
  return schedule.type === 'once'
    ? { ...schedule, at: new Date(schedule.at).toISOString() }
    : { ...schedule, anchorAt: new Date(schedule.anchorAt).toISOString() };
}

/**
 * Returns the next instant strictly after a supplied boundary, or null when exhausted.
 */
export function nextScheduleAt(schedule: Schedule, after: string): string | null {
  const boundary = Date.parse(after);
  if (schedule.type === 'once') {
    return Date.parse(schedule.at) > boundary ? schedule.at : null;
  }
  if (schedule.type === 'interval') {
    const anchor = Date.parse(schedule.anchorAt);
    const step = Math.max(0, Math.floor((boundary - anchor) / schedule.everyMs) + 1);
    const next = anchor + step * schedule.everyMs;
    return Number.isFinite(next) && next <= 8_640_000_000_000_000 ? new Date(next).toISOString() : null;
  }
  const job = cron(schedule);
  try {
    return job.nextRun(new Date(after))?.toISOString() ?? null;
  } finally {
    job.stop();
  }
}

/**
 * Keeps an overdue once instant for misfire handling; intervals start at or after creation.
 */
export function initialScheduleAt(schedule: Schedule, now: string): string | null {
  return schedule.type === 'once'
    ? schedule.at
    : nextScheduleAt(schedule, new Date(Date.parse(now) - 1).toISOString());
}

/**
 * Coalesces backlog in constant space; ordinary wake-loop latency has a 30-second grace.
 */
export function planDue(schedule: Schedule, due: string, now: string, policy: 'skip' | 'coalesce') {
  if (due > now) {
    return { scheduledFor: null, nextRunAt: due };
  }
  return {
    scheduledFor: policy === 'skip' && Date.parse(now) - Date.parse(due) > 30_000 ? null : due,
    nextRunAt: nextScheduleAt(schedule, now),
  };
}
