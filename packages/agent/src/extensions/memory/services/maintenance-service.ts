/**
 * @author Codex
 * @description Stream a consistent Markdown copy using short snapshots and revision checks between export chunks.
 */
import { MemoryError } from '../definitions/error.js';
import type { MemoryRepository } from '../definitions/port.js';
/**
 * Concurrent writes invalidate export instead of producing an apparently complete mixed revision.
 */
export async function* exportWiki(repository: MemoryRepository): AsyncGenerator<string> {
  const start = await repository.read((tx) => tx.meta());
  if (!start) {
    yield '# 全局记忆\n\n暂无记忆。\n';
    return;
  }
  yield '# 全局记忆\n\nStore: ' + start.storeId + ' · Revision: ' + start.revision + '\n\n';
  let before: number | undefined;
  while (true) {
    const batch = await repository.read((tx) => {
      const meta = tx.meta();
      if (meta.storeId !== start.storeId || meta.revision !== start.revision) {
        throw new MemoryError('CURSOR_STALE', '导出期间记忆已变化，请重新导出。');
      }
      return tx.page(before, 10).map((index) => tx.get(index.indexId)!);
    });
    if (!batch?.length) {
      return;
    }
    for (const doc of batch) {
      yield '## ' + doc.topic + ' / ' + doc.indexText + '\n\n' + doc.bodyMd + '\n\n';
    }
    before = batch.at(-1)!.activationSeq;
  }
}
