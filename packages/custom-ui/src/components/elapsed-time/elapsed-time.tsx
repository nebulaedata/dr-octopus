/**
 * @author longlongago2
 * @description Business-agnostic elapsed-time text component backed by a precise interpolated clock.
 */

import type { ReactNode } from 'react';
import { cn } from '@octopus/ui/lib/utils';
import { formatDuration } from './format-duration';
import { usePreciseElapsedTime } from './use-precise-elapsed-time';
import type { DurationFormat } from './types';

export interface ElapsedTimeProps {
  /**
   * Latest authoritative elapsed snapshot in milliseconds.
   */
  elapsedMs: number;

  /**
   * Whether the measured activity is still running. When false, the display
   * freezes on the exact authoritative `elapsedMs`.
   */
  running: boolean;

  /**
   * UI text refresh period in milliseconds. Only controls refresh frequency,
   * never timing accuracy. Defaults to 100ms; pass 1000 for second-granularity
   * formats such as `compact` or `clock`.
   */
  refreshMs?: number;

  /**
   * Output format, defaulting to `auto`.
   */
  format?: DurationFormat;

  className?: string;

  /**
   * Render prop that takes over all output with the current interpolated value.
   *
   * @param elapsedMs - Current interpolated elapsed milliseconds.
   * @returns Custom rendered content.
   */
  children?: (elapsedMs: number) => ReactNode;
}

/**
 * Renders a ticking elapsed-time label from an authoritative snapshot.
 *
 * The component is intentionally business-agnostic: it knows only `elapsedMs`
 * and `running`, never sessions, turns, tools, stores, or transports. Projection
 * to those props happens in the caller's selector layer. Numeric text uses
 * tabular figures so digit width changes never shake the layout.
 *
 * @param props - Authoritative snapshot, run state, and presentation options.
 * @returns A tabular-nums duration label, or the render-prop output.
 */
export function ElapsedTime({
  elapsedMs,
  running,
  refreshMs = 100,
  format = 'auto',
  className,
  children,
}: ElapsedTimeProps) {
  const current = usePreciseElapsedTime({ elapsedMs, running, refreshMs });

  if (children) {
    return <>{children(current)}</>;
  }

  return <span className={cn('tabular-nums', className)}>{formatDuration(current, format)}</span>;
}
