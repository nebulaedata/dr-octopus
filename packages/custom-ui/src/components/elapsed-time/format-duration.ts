/**
 * @author longlongago2
 * @description Unified duration formatting that supersedes the app-local duration utilities.
 */

import type { DurationFormat } from './types';

/**
 * Formats elapsed milliseconds as human-readable duration text.
 *
 * Negative inputs clamp to zero. `compact` preserves the historical
 * `apps/web/src/utils/duration.ts` behavior (sparse parts, at least one second);
 * `clock` keeps a fixed width to avoid layout jitter.
 *
 * @param elapsedMs - Elapsed milliseconds; values below zero are clamped to zero.
 * @param format - Output format, defaulting to `auto`.
 * @returns Formatted duration text such as `683ms`, `2.4s`, `1:13`, or `1h 2m 3s`.
 */
export function formatDuration(elapsedMs: number, format: DurationFormat = 'auto'): string {
  const value = Math.max(0, elapsedMs);

  switch (format) {
    case 'milliseconds':
      return `${Math.round(value)}ms`;
    case 'seconds':
      return `${(value / 1000).toFixed(1)}s`;
    case 'clock':
      return formatClock(value);
    case 'compact':
      return formatCompact(value);
    case 'auto':
    default:
      break;
  }

  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return formatClock(value);
}

/**
 * Formats milliseconds as a fixed-width clock value (`m:ss`, or `h:mm:ss` past one hour).
 *
 * @param value - Non-negative elapsed milliseconds.
 * @returns Zero-padded clock text.
 */
function formatClock(value: number): string {
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/**
 * Formats milliseconds as sparse hour/minute/second parts with at least one second.
 *
 * @param value - Non-negative elapsed milliseconds.
 * @returns Compact duration text such as `45s` or `1h 2m 3s`.
 */
function formatCompact(value: number): string {
  const seconds = Math.max(1, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [
    hours > 0 ? `${String(hours)}h` : undefined,
    minutes > 0 ? `${String(minutes)}m` : undefined,
    `${String(remainder)}s`,
  ]
    .filter((part) => part !== undefined)
    .join(' ');
}
