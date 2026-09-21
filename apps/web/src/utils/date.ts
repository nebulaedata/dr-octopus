/**
 * @author Codex
 * @description Centralizes Day.js configuration and human-readable date formatting for the web client.
 */

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/**
 * Renders a Session creation date as a compact calendar date.
 *
 * @param date - ISO string, epoch timestamp, or Date instance.
 * @returns Localized date in `YYYY-MM-DD` form.
 */
export function formatSessionCreated(date: string | number | Date): string {
  return dayjs(date).format('YYYY-MM-DD');
}

/**
 * Renders a message timestamp as either just the time or a date-time,
 * depending on whether it falls on the current calendar day.
 *
 * @param timestamp - Epoch timestamp in milliseconds.
 * @returns `HH:mm` for messages from today, otherwise `YYYY-MM-DD HH:mm`.
 */
export function formatMessageTime(timestamp: number): string {
  const then = dayjs(timestamp);
  const now = dayjs();
  return then.isSame(now, 'day') ? then.format('HH:mm') : then.format('YYYY-MM-DD HH:mm');
}

/**
 * Renders how long ago a Session was last active in relative terms.
 *
 * @param date - ISO string, epoch timestamp, or Date instance.
 * @returns Localized relative time such as "3天前" or "1小时前".
 */
export function formatRelativeTime(date: string | number | Date): string {
  return dayjs(date).fromNow();
}

/**
 * Formats a local date/time with Day.js, preserving invalid values for diagnostics.
 *
 * @param value - ISO string, epoch milliseconds, or Date; missing values render as a dash.
 * @param template - Day.js display template, defaulting to full date and time with seconds.
 * @returns Formatted local time, a dash for missing values, or the original invalid value.
 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  template = 'YYYY-MM-DD HH:mm:ss'
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const date = dayjs(value);
  return date.isValid() ? date.format(template) : String(value);
}
