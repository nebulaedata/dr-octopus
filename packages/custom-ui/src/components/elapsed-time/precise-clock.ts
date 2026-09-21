/**
 * @author longlongago2
 * @description Anchor-based precise clock that interpolates elapsed time from a monotonic time source.
 */

/**
 * Monotonic millisecond time source, injectable for deterministic tests.
 */
export type ClockNow = () => number;

/**
 * Interpolates authoritative elapsed snapshots through a monotonic local clock.
 *
 * The clock never accumulates (`elapsed += interval`); the current value is always
 * recomputed as `baseElapsedMs + now() - anchorMs`, so callback jitter, throttled
 * timers, and background tabs cannot cause drift. The injected `now` defaults to
 * `performance.now()` and must only be read inside methods, never at module scope,
 * keeping the class safe for SSR import graphs.
 */
export class PreciseClock {
  private readonly now: ClockNow;
  private baseElapsedMs = 0;
  private anchorMs = 0;
  private running = false;

  /**
   * Creates a clock bound to one monotonic time source.
   *
   * @param now - Monotonic millisecond clock; defaults to `performance.now()`.
   */
  constructor(now: ClockNow = () => performance.now()) {
    this.now = now;
  }

  /**
   * Starts (or restarts) interpolation from an authoritative elapsed snapshot.
   *
   * @param elapsedMs - Authoritative elapsed milliseconds at the sync moment.
   */
  start(elapsedMs = 0): void {
    this.baseElapsedMs = elapsedMs;
    this.anchorMs = this.now();
    this.running = true;
  }

  /**
   * Re-anchors the clock to a newer authoritative snapshot without changing run state.
   *
   * @param elapsedMs - Authoritative elapsed milliseconds at the sync moment.
   */
  sync(elapsedMs: number): void {
    this.baseElapsedMs = elapsedMs;
    this.anchorMs = this.now();
  }

  /**
   * Freezes the clock. With a final authoritative value the clock adopts it;
   * otherwise it freezes at the currently interpolated value.
   *
   * @param elapsedMs - Final authoritative elapsed milliseconds, when known.
   */
  stop(elapsedMs?: number): void {
    if (elapsedMs !== undefined) {
      this.baseElapsedMs = elapsedMs;
    } else if (this.running) {
      this.baseElapsedMs = this.elapsedMs;
    }
    this.running = false;
  }

  /**
   * Clears all state back to a stopped zero clock.
   */
  reset(): void {
    this.baseElapsedMs = 0;
    this.anchorMs = 0;
    this.running = false;
  }

  /**
   * Current elapsed milliseconds: interpolated while running, frozen otherwise.
   */
  get elapsedMs(): number {
    if (!this.running) {
      return this.baseElapsedMs;
    }
    return this.baseElapsedMs + this.now() - this.anchorMs;
  }
}
