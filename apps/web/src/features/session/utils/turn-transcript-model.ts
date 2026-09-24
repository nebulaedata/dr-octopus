/**
 * @author Codex
 * @description Locates explicit Turn boundaries without inferring ownership from neighboring transcript rows.
 */

import type { TranscriptItem } from '@/stores/session';

/**
 * Returns the final transcript index owned by every Turn so duration markers can be inserted deterministically.
 */
export function getLastItemIndexByTurn(items: TranscriptItem[]): Map<string, number> {
  const lastItemIndexByTurn = new Map<string, number>();
  items.forEach((item, index) => {
    if ('turnId' in item && item.turnId !== undefined) {
      lastItemIndexByTurn.set(item.turnId, index);
    }
  });
  return lastItemIndexByTurn;
}
