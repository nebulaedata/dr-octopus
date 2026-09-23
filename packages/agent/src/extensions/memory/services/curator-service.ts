/**
 * @author Codex
 * @description Bounded evidence-only curation with atomic batches, cancellation fences and one conflict reassessment.
 */
import { memoryRememberSchema } from '@octopus/shared/protocol/memory';
import { MemoryError } from '../definitions/error.js';
import { applyRemember, sourceKey } from './mutation-service.js';
import type { MemoryHash } from './mutation-service.js';
import type { MemoryRepository } from '../definitions/port.js';
import type {
  MemorySource,
  MemoryCurator,
  MemoryDocument,
  CuratorInput,
  MemoryRemember,
  MemoryReceipt,
} from '../definitions/types.js';
/**
 * Reassess a conflicting batch once from fresh facts; never overwrite an unseen revision.
 */
export async function* curationSteps(
  repository: MemoryRepository,
  hash: MemoryHash,
  sources: MemorySource[],
  signal: AbortSignal,
  explicit: boolean
): AsyncGenerator<CuratorInput, MemoryReceipt[], MemoryRemember[]> {
  const meta = await repository.read((tx) => tx.meta());
  if (!meta || meta.mode === 'off' || (meta.mode !== 'auto' && !explicit) || !sources.length) {
    return [];
  }
  const requestId = 'curate:' + hash(sources.map(sourceKey).join('|'));
  if (await repository.read((tx) => tx.receipt(requestId))) {
    return [];
  }
  const usable = await repository.read((tx) =>
    sources.filter((source) => !tx.blocked(hash(sourceKey(source)))).slice(-8)
  );
  if (!usable?.length) {
    return [];
  }
  const allowed = new Map(usable.map((source) => [sourceKey(source), source]));
  let conflictKeys: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const existing = await repository.read((tx) => {
      let candidates: MemoryDocument[] = [];
      try {
        candidates = tx
          .search(
            usable
              .map((s) => s.evidence)
              .join(' ')
              .slice(0, 300)
          )
          .slice(0, 5)
          .flatMap((index) => {
            const doc = tx.get(index.indexId);
            return doc ? [doc] : [];
          });
      } catch {
        /* FTS is optional; canonical conflicts still require reassessment. */
      }
      const conflicts = conflictKeys.flatMap((key) => {
        const doc = tx.canonical(key.toLowerCase());
        return doc ? [doc] : [];
      });
      const docs = [...new Map([...conflicts, ...candidates].map((doc) => [doc.indexId, doc])).values()];
      const bounded: MemoryDocument[] = [];
      let bytes = Buffer.byteLength(JSON.stringify(usable));
      for (const doc of docs) {
        const size = Buffer.byteLength(JSON.stringify(doc));
        if (bytes + size <= 24000) {
          bounded.push(doc);
          bytes += size;
        }
      }
      return bounded;
    });
    const proposed = yield { sources: usable, existing: existing ?? [], explicit };
    const validated = proposed.slice(0, 5).map((item) => {
      const value = memoryRememberSchema.safeParse(item);
      if (!value.success) {
        throw new MemoryError('INVALID_INPUT', '整理结果格式无效。');
      }
      return value.data;
    });
    if (
      validated.some(
        (item) => !item.sources.length || item.sources.some((source) => !allowed.has(sourceKey(source)))
      )
    ) {
      throw new MemoryError('INVALID_INPUT', '整理结果缺少有效用户来源。');
    }
    if (
      validated.some(
        (item) =>
          item.target &&
          !existing?.some(
            (doc) =>
              doc.storeId === item.target?.storeId &&
              doc.indexId === item.target.indexId &&
              doc.revision === item.expectedRevision
          )
      )
    ) {
      throw new MemoryError('INVALID_INPUT', '整理结果不能修改未读取的事实。');
    }
    try {
      return await repository.write((tx) => {
        signal.throwIfAborted();
        if (tx.meta().writeEpoch !== meta.writeEpoch) {
          throw new MemoryError('CANCELLED', '记忆策略已变化。');
        }
        if (tx.receipt(requestId)) {
          return [];
        }
        const receipts = validated.map((item, i) =>
          applyRemember(
            tx,
            {
              ...item,
              sources: item.sources.map((source) => allowed.get(sourceKey(source))!),
              requestId: requestId + ':' + i,
            },
            hash,
            { epoch: meta.writeEpoch, signal }
          )
        );
        tx.record(requestId, {
          requestId,
          action: 'curate',
          status: 'committed',
          revision: tx.meta().revision,
        });
        return receipts;
      }, signal);
    } catch (error) {
      if (!(error instanceof MemoryError) || error.code !== 'REVISION_CONFLICT' || attempt === 1) {
        throw error;
      }
      conflictKeys = validated.map((item) => item.canonicalKey);
    }
  }
  return [];
}

/**
 * Drive the same transaction rules for an in-process curator.
 */
export async function curateRun(
  repository: MemoryRepository,
  hash: MemoryHash,
  sources: MemorySource[],
  curator: MemoryCurator,
  signal: AbortSignal,
  explicit: boolean
) {
  const steps = curationSteps(repository, hash, sources, signal, explicit);
  try {
    let step = await steps.next();
    while (!step.done) {
      step = await steps.next(await curator(step.value, signal));
    }
    return step.value;
  } finally {
    await steps.return([]);
  }
}
