/**
 * @author Codex
 * @description Merges bounded workspace streams into a globally ordered task page.
 */
import type { ScheduledTask } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Match the daemon's descending update time and stable identifier ordering.
 */
function compare(left: ScheduledTask, right: ScheduledTask): number {
  for (const field of ['updatedAt', 'id'] as const) {
    if (left[field] !== right[field]) {
      return left[field] > right[field] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Consume only enough sorted rows to fill the requested page, retaining one batch per workspace.
 */
export async function mergeSortedPage<T>(
  readers: Array<(offset: number, limit: number) => Promise<T[]>>,
  offset: number,
  limit: number,
  compareRows: (left: T, right: T) => number
): Promise<T[]> {
  const size = 100;
  const cursors = await Promise.all(
    readers.map(async (read) => ({ read, rows: await read(0, size), index: 0, offset: 0 }))
  );
  const items: T[] = [];
  for (let position = 0; position < offset + limit; position++) {
    let winner: (typeof cursors)[number] | undefined;
    for (const cursor of cursors) {
      if (
        cursor.index < cursor.rows.length &&
        (!winner || compareRows(cursor.rows[cursor.index]!, winner.rows[winner.index]!) < 0)
      ) {
        winner = cursor;
      }
    }
    if (!winner) {
      break;
    }
    const row = winner.rows[winner.index++]!;
    if (position >= offset) {
      items.push(row);
    }
    if (position + 1 < offset + limit && winner.index === size) {
      winner.offset += size;
      winner.rows = await winner.read(winner.offset, size);
      winner.index = 0;
    }
  }
  return items;
}

/**
 * Merge task catalogs with the daemon's stable task ordering.
 */
export function mergeTaskPage(
  readers: Array<(offset: number, limit: number) => Promise<ScheduledTask[]>>,
  offset: number,
  limit: number
) {
  return mergeSortedPage(readers, offset, limit, compare);
}
