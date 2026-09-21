/**
 * @author Codex
 * @description Revision-bound cursors and conservative byte budgets for model memory retrieval.
 */
import { MemoryError } from '../definitions/error.js';
import type { MemoryTransaction } from '../definitions/port.js';
import type {
  MemoryPage,
  MemoryRead,
  MemoryReadResult,
  MemoryRecall,
  MemoryRef,
} from '../definitions/types.js';
/**
 * Encode only bounded, non-secret continuation fields.
 */
export function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
/**
 * Validate the store and revision before following an opaque continuation.
 */
function decodeCursor(cursor: string, tx: MemoryTransaction): Record<string, unknown> {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new MemoryError('INVALID_INPUT', '无效的记忆游标。');
  }
  const meta = tx.meta();
  if (!value || value.version !== 1 || value.storeId !== meta.storeId || value.revision !== meta.revision) {
    throw new MemoryError('CURSOR_STALE', '记忆已变化，请从首页重新查询。');
  }
  return value;
}
/**
 * List or search active facts, advancing only past records actually returned to the caller.
 */
export function recall(tx: MemoryTransaction, input: MemoryRecall, maxBytes = 9000): MemoryPage {
  const meta = tx.meta();
  let before: number | undefined;
  let unavailable = false;
  if (input.mode === 'page' && input.cursor) {
    const value = decodeCursor(input.cursor, tx);
    if (
      value.kind !== 'page' ||
      typeof value.before !== 'number' ||
      !Number.isSafeInteger(value.before) ||
      value.before <= 0
    ) {
      throw new MemoryError('INVALID_INPUT', '无效分页游标。');
    }
    before = value.before;
  }
  let candidates = tx.page(before, 101);
  if (input.mode === 'search') {
    try {
      candidates = tx.search(input.query);
    } catch {
      candidates = [];
      unavailable = true;
    }
  }
  const items: MemoryPage['items'] = [];
  let bytes = 0;
  for (const item of candidates.slice(0, 100)) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (bytes + size > maxBytes) {
      break;
    }
    items.push(item);
    bytes += size;
  }
  const exhausted = input.mode === 'page' && items.length === candidates.length;
  const result: MemoryPage = {
    version: 1,
    action: 'recall',
    items,
    revision: meta.revision,
    exhausted,
    complete: !unavailable && (input.mode === 'page' ? exhausted : items.length === candidates.length),
    ...(unavailable ? { searchUnavailable: true } : {}),
  };
  if (input.mode === 'page' && !exhausted && items.length) {
    result.nextCursor = encodeCursor({
      version: 1,
      kind: 'page',
      storeId: meta.storeId,
      revision: meta.revision,
      before: items.at(-1)!.activationSeq,
    });
  }
  if (!exhausted) {
    result.stopReason = unavailable
      ? 'search_unavailable'
      : input.mode === 'search'
        ? 'search_candidates'
        : 'page_limit';
  }
  return result;
}
/**
 * Read bounded portions of sections, retaining input order and revision-bound continuation.
 */
export function read(tx: MemoryTransaction, input: MemoryRead, maxBytes = 14000): MemoryReadResult {
  const meta = tx.meta();
  let position = 0,
    offset = 0;
  const signature = JSON.stringify(input.refs);
  if (input.continuation) {
    const cursor = decodeCursor(input.continuation, tx);
    if (
      cursor.kind !== 'read' ||
      cursor.refs !== signature ||
      !Number.isSafeInteger(cursor.position) ||
      !Number.isSafeInteger(cursor.offset)
    ) {
      throw new MemoryError('INVALID_INPUT', '无效正文游标。');
    }
    position = Number(cursor.position);
    offset = Number(cursor.offset);
    if (position < 0 || position >= input.refs.length || offset < 0) {
      throw new MemoryError('INVALID_INPUT', '无效正文位置。');
    }
  }
  const items: MemoryReadResult['items'] = [];
  let remaining = maxBytes - 1600;
  for (let i = position; i < input.refs.length; i++) {
    const ref = input.refs[i]!;
    const doc = ref.storeId === meta.storeId ? tx.get(ref.indexId) : undefined;
    if (!doc || doc.status !== 'active') {
      items.push({ ref, error: 'NOT_FOUND' });
      continue;
    }
    const sources =
      maxBytes > 14000
        ? doc.sources
        : doc.sources.slice(0, 3).map((source) => ({ ...source, evidence: source.evidence.slice(0, 160) }));
    const overhead =
      Buffer.byteLength(JSON.stringify({ ref, document: { ...doc, bodyMd: '', sources } })) + 10;
    if (remaining < overhead + 10 && items.length) {
      return {
        version: 1,
        action: 'read',
        items,
        complete: false,
        stopReason: 'byte_budget',
        continuation: encodeCursor({
          version: 1,
          kind: 'read',
          storeId: meta.storeId,
          revision: meta.revision,
          refs: signature,
          position: i,
          offset: i === position ? offset : 0,
        }),
      };
    }
    remaining -= overhead;
    const start = i === position ? offset : 0;
    if (start > doc.bodyMd.length) {
      throw new MemoryError('INVALID_INPUT', '正文游标越界。');
    }
    let end = start;
    while (end < doc.bodyMd.length && remaining > 10) {
      const char = String.fromCodePoint(doc.bodyMd.codePointAt(end)!);
      const cost = Buffer.byteLength(JSON.stringify(char)) - 2;
      if (cost > remaining) {
        break;
      }
      remaining -= cost;
      end += char.length;
    }
    items.push({ ref, document: { ...doc, bodyMd: doc.bodyMd.slice(start, end), sources } });
    if (end < doc.bodyMd.length || (remaining < 1000 && i + 1 < input.refs.length)) {
      return {
        version: 1,
        action: 'read',
        items,
        complete: false,
        stopReason: 'byte_budget',
        continuation: encodeCursor({
          version: 1,
          kind: 'read',
          storeId: meta.storeId,
          revision: meta.revision,
          refs: signature,
          position: end < doc.bodyMd.length ? i : i + 1,
          offset: end < doc.bodyMd.length ? end : 0,
        }),
      };
    }
  }
  return { version: 1, action: 'read', items, complete: true };
}
/**
 * Identify deleted references without consuming a model recall budget.
 */
export function missing(tx: MemoryTransaction, refs: MemoryRef[]): boolean {
  return refs.some((ref) => ref.storeId !== tx.meta().storeId || tx.get(ref.indexId)?.status !== 'active');
}
