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

/**
 * Group adjacent prose while keeping each structured tool call separate and in source order.
 * IDs remain stable within the original message; pagination still counts original messages.
 */
export function projectExecutionMessage(id: string, role: string, content: unknown) {
  const items: { id: string; role: string; text: string }[] = [];
  const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  if (!Array.isArray(parts)) {
    return items;
  }
  for (const [index, value] of (parts as unknown[]).entries()) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const part = value as Record<string, unknown>;
    const toolCall = role === 'assistant' && part.type === 'toolCall' && typeof part.name === 'string';
    let text: string;
    if (toolCall) {
      text = `[${String(part.name)}]\n${JSON.stringify(part.arguments, null, 2) ?? '{}'}`;
    } else {
      if (part.type === 'text' && typeof part.text === 'string') {
        text = part.text;
      } else {
        if (part.type === 'image') {
          text = '[图片内容保存在执行记录中]';
        } else {
          text = '';
        }
      }
    }
    if (!text) {
      continue;
    }
    const previous = items.at(-1);
    if (!toolCall && previous?.role === role) {
      previous.text += `\n${text}`;
    } else {
      items.push({ id: `${id}:${index}`, role: toolCall ? 'toolCall' : role, text });
    }
  }
  return items;
}
