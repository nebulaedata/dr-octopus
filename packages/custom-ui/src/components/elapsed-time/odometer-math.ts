/**
 * @author longlongago2
 * @description Pure roll-position math for the continuous odometer elapsed-time display.
 */

/**
 * Digit strip rendered by each odometer column: 0-9 plus a duplicate 0 so the
 * wrap from 9.x back to 0 lands on an identical glyph without a visible jump.
 */
export const ODOMETER_DIGIT_STRIP: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/**
 * Fraction of the one-second units cycle spent rolling into each carry. Every
 * stepped column rolls inside this same window, so all wheels involved in a
 * carry move together like sequential mechanical gearing.
 */
export const ODOMETER_ROLL_WINDOW = 0.2;

/**
 * Roll window in milliseconds: every stepped column rolls during the last
 * {@link ODOMETER_ROLL_WINDOW} of the one-second units cycle before a carry.
 */
const ROLL_WINDOW_MS = ODOMETER_ROLL_WINDOW * 1000;

/**
 * Counts the integer-second digit columns needed to display an elapsed value.
 *
 * @param elapsedMs - Elapsed milliseconds.
 * @returns Column count, at least one.
 */
export function secondsDigitCount(elapsedMs: number): number {
  return Math.max(1, Math.floor(Math.max(0, elapsedMs) / 1000).toString(10).length);
}

/**
 * Counts the digit columns the odometer must render at a moment in time.
 *
 * Unlike {@link secondsDigitCount}, the count grows one column early, exactly
 * when the value enters the roll window before a magnitude boundary (9.8s
 * rolls into `10`), so the new higher wheel rolls in together with the carry
 * instead of the display blanking to `0s`/`00s` until the boundary lands.
 *
 * @param elapsedMs - Current elapsed milliseconds.
 * @returns Column count, at least one.
 */
export function odometerDigitCount(elapsedMs: number): number {
  return secondsDigitCount(Math.max(0, elapsedMs) + ROLL_WINDOW_MS);
}

/**
 * Computes a column's roll position in `[0, 10]`, where the integer part picks
 * the visible digit and the fraction scrolls between digits.
 *
 * Continuous columns scroll constantly (the tenths digit). Stepped columns
 * rest on their digit and roll to the next one during the last
 * {@link ROLL_WINDOW_MS} milliseconds before each of their own carry
 * boundaries; because the window is a fixed slice of the units cycle, every
 * column involved in a carry (9.9s -> 10.0s) rolls in the same 200ms, like
 * sequential mechanical gearing.
 *
 * @param elapsedMs - Current elapsed milliseconds.
 * @param unitMs - Milliseconds represented by one step of this column.
 * @param continuous - Whether the column scrolls continuously.
 * @returns Roll position; approaches 10 at a carry, which the strip's duplicate 0 covers.
 */
export function odometerColumnPosition(elapsedMs: number, unitMs: number, continuous: boolean): number {
  const clamped = Math.max(0, elapsedMs);
  const position = (clamped / unitMs) % 10;
  if (continuous) {
    return position;
  }
  const progress = Math.min(Math.max((clamped % unitMs) - (unitMs - ROLL_WINDOW_MS), 0) / ROLL_WINDOW_MS, 1);
  return Math.floor(position) + easeOutCubic(progress);
}

/**
 * Eases a stepped roll so it accelerates into the next digit and settles.
 *
 * @param progress - Normalized roll progress in `[0, 1]`.
 * @returns Eased progress in `[0, 1]`.
 */
function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}
