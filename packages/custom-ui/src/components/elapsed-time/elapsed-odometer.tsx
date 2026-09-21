/**
 * @author longlongago2
 * @description Continuous odometer elapsed-time display driven by a MotionValue without re-rendering React.
 */

import { useState } from 'react';
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { cn } from '@octopus/ui/lib/utils';
import { ElapsedTime } from './elapsed-time';
import { ODOMETER_DIGIT_STRIP, odometerColumnPosition, odometerDigitCount } from './odometer-math';
import { useElapsedMotionValue } from './use-elapsed-motion-value';

/**
 * Milliseconds represented by the smallest odometer column (whole seconds).
 * Sub-second wheels spin too fast to read, so stopped values are rounded to
 * this granularity and every digit rests exactly on its glyph.
 */
const SECONDS_MS = 1000;

export interface ElapsedOdometerProps {
  /**
   * Latest authoritative elapsed snapshot in milliseconds.
   */
  elapsedMs: number;

  /**
   * Whether the measured activity is still running. When false, the wheels
   * freeze on the exact authoritative `elapsedMs`, rounded to whole seconds.
   */
  running: boolean;

  className?: string;
}

/**
 * Renders elapsed time as a mechanical odometer in whole seconds (`42s`).
 *
 * Every wheel rests on its digit and rolls to the next one during the last
 * fraction of each units cycle, all computed inside MotionValue transforms at
 * `requestAnimationFrame` cadence, so a ticking display never re-renders
 * React. Digit columns are added as the value enters the roll window before a
 * magnitude boundary, so the new wheel rolls in together with the carry
 * instead of popping in afterwards. When the user prefers reduced motion, the
 * display degrades to a plain `ElapsedTime` text label.
 *
 * The animated digit strip is `aria-hidden`; an offscreen `ElapsedTime`
 * ticking at one-second cadence carries the accessible value, so assistive
 * technology never reads a frozen time.
 *
 * The component is business-agnostic: it knows only `elapsedMs` and `running`,
 * matching the elapsed-time module's red lines.
 *
 * @param props - Authoritative snapshot, run state, and presentation options.
 * @returns An animated odometer label, or a plain label for reduced motion.
 */
export function ElapsedOdometer({ elapsedMs, running, className }: ElapsedOdometerProps) {
  const displayMs = running ? elapsedMs : Math.round(elapsedMs / SECONDS_MS) * SECONDS_MS;
  const value = useElapsedMotionValue({ elapsedMs: displayMs, running });
  const reducedMotion = useReducedMotion();
  const [digitCount, setDigitCount] = useState(() => odometerDigitCount(displayMs));
  useMotionValueEvent(value, 'change', (latest) => {
    const next = odometerDigitCount(latest);
    setDigitCount((previous) => (previous === next ? previous : next));
  });
  const effectiveDigitCount = Math.max(digitCount, odometerDigitCount(displayMs));

  if (reducedMotion === true) {
    return (
      <ElapsedTime
        elapsedMs={displayMs}
        running={running}
        refreshMs={1000}
        format="compact"
        className={className}
      />
    );
  }

  return (
    <span role="timer" className={cn('inline-flex items-center tabular-nums', className)}>
      <ElapsedTime
        elapsedMs={displayMs}
        running={running}
        refreshMs={1000}
        format="compact"
        className="sr-only"
      />
      <span aria-hidden="true" className="inline-flex items-center">
        {Array.from({ length: effectiveDigitCount }, (_, index) => (
          <OdometerDigit key={index} value={value} unitMs={10 ** (effectiveDigitCount - 1 - index) * 1000} />
        ))}
        <span>s</span>
      </span>
    </span>
  );
}

interface OdometerDigitProps {
  /**
   * Shared MotionValue holding the current elapsed milliseconds.
   */
  value: MotionValue<number>;

  /**
   * Milliseconds represented by one step of this column.
   */
  unitMs: number;
}

/**
 * Renders one odometer wheel as a clipped vertical digit strip whose scroll
 * offset is derived from the shared elapsed MotionValue.
 *
 * @param props - Shared motion value and column unit.
 * @returns A fixed-width digit window.
 */
function OdometerDigit({ value, unitMs }: OdometerDigitProps) {
  const y = useTransform(value, (latest) => `${String(-odometerColumnPosition(latest, unitMs, false))}em`);
  return (
    <span className="inline-block h-[1em] w-[1ch] overflow-hidden">
      <motion.span className="flex flex-col" style={{ y }}>
        {ODOMETER_DIGIT_STRIP.map((digit, index) => (
          <span key={index} className="flex h-[1em] items-center justify-center leading-none">
            {digit}
          </span>
        ))}
      </motion.span>
    </span>
  );
}
