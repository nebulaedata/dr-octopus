/**
 * @author longlongago2
 * @description Drives frame-rate elapsed-time animations through a MotionValue without re-rendering React.
 */

import { useEffect, useRef, useState } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';
import { PreciseClock } from './precise-clock';

export interface UseElapsedMotionValueOptions {
  /**
   * Latest authoritative elapsed snapshot in milliseconds.
   */
  elapsedMs: number;

  /**
   * Whether the measured activity is still running.
   */
  running: boolean;
}

/**
 * Streams interpolated elapsed time into a `MotionValue` for high-frequency
 * visuals (progress rings, pulses, trails) at `requestAnimationFrame` cadence.
 *
 * Shares the same {@link PreciseClock} interpolation model as
 * `usePreciseElapsedTime`, so text and motion never disagree; the MotionValue
 * writes straight to the DOM and never triggers a React render per frame.
 * While running, the streamed value is clamped monotonic so a stale
 * authoritative re-sync never rolls visuals backwards; the clamp baseline
 * resets on each fresh run start, and when `running` flips false the final
 * authoritative value is adopted exactly, even if that steps backwards.
 *
 * @param options - Authoritative snapshot and run state.
 * @returns Motion value holding the current elapsed milliseconds.
 */
export function useElapsedMotionValue({
  elapsedMs,
  running,
}: UseElapsedMotionValueOptions): MotionValue<number> {
  const value = useMotionValue(elapsedMs);
  const [clock] = useState(() => new PreciseClock());
  const lastDisplayRef = useRef(elapsedMs);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (!running) {
      wasRunningRef.current = false;
      clock.stop(elapsedMs);
      lastDisplayRef.current = elapsedMs;
      value.set(elapsedMs);
      return;
    }

    if (!wasRunningRef.current) {
      wasRunningRef.current = true;
      lastDisplayRef.current = elapsedMs;
      clock.start(elapsedMs);
    } else {
      clock.sync(elapsedMs);
    }

    const publish = () => {
      const next = Math.max(lastDisplayRef.current, clock.elapsedMs);
      lastDisplayRef.current = next;
      value.set(next);
    };
    publish();

    let raf = 0;
    const frame = () => {
      publish();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, [clock, elapsedMs, running, value]);

  return value;
}
