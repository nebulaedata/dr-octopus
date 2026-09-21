/**
 * @author Codex
 * @description Export through bounded remote pages, rejecting mixed-revision snapshots.
 */
import { MemoryError } from '../definitions/error.js';
import type { MemoryService } from '../services/memory-service.js';
/**
 * Stream Markdown without loading SQLite or retaining an unbounded daemon-side export buffer.
 */
export async function* exportRemoteWiki(service: MemoryService): AsyncGenerator<string> {
  const initial = await service.getStatus();
  if (!initial.storeId) {
    yield '# 全局记忆\n\n暂无记忆。\n';
    return;
  }
  yield '# 全局记忆\n\nStore: ' + initial.storeId + ' · Revision: ' + initial.revision + '\n\n';
  let cursor: string | undefined;
  do {
    const page = await service.recall({ mode: 'page', cursor });
    if (page.revision !== initial.revision) {
      throw new MemoryError('CURSOR_STALE', '导出期间记忆已变化，请重新导出。');
    }
    for (const ref of page.items) {
      const part = await service.read({ refs: [{ storeId: ref.storeId, indexId: ref.indexId }] }, 128000);
      const current = await service.getStatus();
      const doc = part.items[0]?.document;
      if (
        !doc ||
        !part.complete ||
        current.storeId !== initial.storeId ||
        current.revision !== initial.revision
      ) {
        throw new MemoryError('CURSOR_STALE', '导出期间记忆已变化，请重新导出。');
      }
      yield '## ' + doc.topic + ' / ' + doc.indexText + '\n\n' + doc.bodyMd + '\n\n';
    }
    cursor = page.nextCursor;
  } while (cursor);
}
