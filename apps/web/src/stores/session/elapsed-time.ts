/**
 * @author longlongago2
 * @description Derives authoritative elapsed-time snapshots from Server-clock-domain projections.
 */

import type { SessionProjectionState } from './type';

/**
 * Resolves one Turn's authoritative elapsed snapshot in milliseconds.
 *
 * Settled turns report their final `endedAt - startedAt`; running turns report
 * `lastServerTimestamp - startedAt`, which re-anchors on every inbound Host event.
 * Both operands always live in the Server clock domain, so the browser wall clock
 * never enters the arithmetic; the UI layer interpolates forward from this
 * snapshot with its own monotonic clock.
 *
 * @param state - Current Session projection.
 * @param turnId - Turn identity to resolve.
 * @returns Non-negative elapsed milliseconds, or undefined when the Turn is unknown.
 */
export function selectTurnElapsedMs(state: SessionProjectionState, turnId: string): number | undefined {
  const turn = state.turnsById[turnId];
  if (turn === undefined) {
    return undefined;
  }
  return Math.max(0, (turn.endedAt ?? state.lastServerTimestamp) - turn.startedAt);
}
