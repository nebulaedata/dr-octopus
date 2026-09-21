/**
 * @author longlongago2
 * @description Shared contracts for the business-agnostic elapsed-time module.
 */

/**
 * Duration text formats supported by the elapsed-time module.
 *
 * - `auto`: milliseconds below 1s, one-decimal seconds below 1min, fixed-width clock beyond.
 * - `seconds`: one-decimal seconds (e.g. `12.4s`).
 * - `milliseconds`: rounded milliseconds (e.g. `683ms`).
 * - `clock`: fixed-width `m:ss` or `h:mm:ss`.
 * - `compact`: sparse hour/minute/second parts (e.g. `1h 2m 3s`, at least `1s`).
 */
export type DurationFormat = 'auto' | 'seconds' | 'milliseconds' | 'clock' | 'compact';
