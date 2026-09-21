/**
 * @author longlongago2
 * @description React hook that renders authoritative elapsed snapshots through a precise local clock.
 */

import { useEffect, useRef, useState } from 'react';
import { PreciseClock } from './precise-clock';

export interface UsePreciseElapsedTimeOptions {
  /**
   * Latest authoritative elapsed snapshot in milliseconds.
   * Server-clock-domain flows pass the most recent synced value; client-authoritative
   * flows (purely local timers) pass the starting offset, usually `0`.
   */
  elapsedMs: number;

  /**
   * Whether the measured activity is still running.
   */
  running: boolean;

  /**
   * UI text refresh period in milliseconds. Only controls how often the display
   * re-renders; it never affects timing accuracy. Defaults to 100ms.
   */
  refreshMs?: number;
}

/**
 * Interpolates an authoritative elapsed snapshot with a {@link PreciseClock} and
 * re-renders at a low fixed cadence.
 *
 * The refresh timer only decides when the UI updates, never how much time has
 * passed, so throttled callbacks cannot drift the display. While running, the
 * displayed value is clamped monotonic so a stale server re-sync never moves the
 * text backwards; the clamp baseline resets on each fresh run start, and when
 * `running` flips false the final authoritative value is adopted exactly, even
 * if that steps the display backwards. Distinct runs should still pass a stable
 * `key` (e.g. the run id) for a clean component lifecycle.
 *
 * @param options - Authoritative snapshot, run state, and refresh cadence.
 * @returns Currently displayable elapsed milliseconds.
 */
export function usePreciseElapsedTime({
  elapsedMs,
  running,
  refreshMs = 100,
}: UsePreciseElapsedTimeOptions): number {
  const [clock] = useState(() => new PreciseClock());
  const [displayElapsed, setDisplayElapsed] = useState(elapsedMs);
  const lastDisplayRef = useRef(elapsedMs);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (!running) {
      wasRunningRef.current = false;
      clock.stop(elapsedMs);
      lastDisplayRef.current = elapsedMs;
      return;
    }

    if (!wasRunningRef.current) {
      wasRunningRef.current = true;
      lastDisplayRef.current = elapsedMs;
      clock.start(elapsedMs);
    } else {
      clock.sync(elapsedMs);
    }

    let timeout: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const update = () => {
      if (cancelled) {
        return;
      }
      const next = Math.max(lastDisplayRef.current, clock.elapsedMs);
      lastDisplayRef.current = next;
      setDisplayElapsed(next);
      timeout = setTimeout(update, refreshMs);
    };

    timeout = setTimeout(update, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [clock, elapsedMs, running, refreshMs]);

  return running ? displayElapsed : elapsedMs;
}
