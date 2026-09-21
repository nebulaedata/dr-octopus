/**
 * @author Codex
 * @description Fact mutation policy, optimistic revisions, idempotency and deletion fences.
 */
import { MemoryError } from '../definitions/error.js';
import type { MemoryTransaction } from '../definitions/port.js';
import type { MemoryRemember, MemoryReceipt, MemoryWriteGuard, MemorySource } from '../definitions/types.js';
export type MemoryHash = (value: string) => string;
/**
 * Derive a stable source identity independent of model wording or fact keys.
 */
export function sourceKey(source: MemorySource): string {
  return 'source:' + source.sessionId + ':' + source.entryId;
}
/**
 * Reject conflicting reuse of a request ID, otherwise return its durable receipt.
 */
export function priorReceipt(
  tx: MemoryTransaction,
  id: string,
  input: unknown,
  hash: MemoryHash
): MemoryReceipt | undefined {
  const prior = tx.receipt(id);
  if (!prior) {
    return;
  }
  if (prior.hash !== hash(JSON.stringify(input))) {
    throw new MemoryError('REVISION_CONFLICT', '请求标识已用于不同内容。');
  }
  return prior.receipt;
}
/**
 * Apply a fully validated candidate inside the repository's immediate transaction.
 */
export function applyRemember(
  tx: MemoryTransaction,
  input: MemoryRemember,
  hash: MemoryHash,
  guard?: MemoryWriteGuard
): MemoryReceipt {
  const prior = priorReceipt(tx, input.requestId, input, hash);
  if (prior) {
    return prior;
  }
  const meta = tx.meta();
  if (guard) {
    guard.signal.throwIfAborted();
    if (meta.writeEpoch !== guard.epoch || meta.mode === 'off') {
      throw new MemoryError('CANCELLED', '记忆策略或删除屏障已经改变。');
    }
  }
  const key = input.canonicalKey.trim().toLowerCase();
  if (
    guard &&
    (tx.blocked(hash('canonical:' + key)) ||
      input.sources.some((source) => tx.blocked(hash(sourceKey(source)))))
  ) {
    throw new MemoryError('CANCELLED', '已忘记的资料不会自动恢复。');
  }
  const current = tx.canonical(key);
  if (input.target) {
    if (input.target.storeId !== meta.storeId) {
      throw new MemoryError('NOT_FOUND', '记忆引用来自其他数据库。');
    }
    const target = tx.get(input.target.indexId);
    if (!target || target.status !== 'active') {
      throw new MemoryError('NOT_FOUND', '记忆已删除或已被替代。');
    }
    if (target.canonicalKey !== key || target.revision !== input.expectedRevision) {
      throw new MemoryError('REVISION_CONFLICT', '记忆已更新，请刷新后重试。');
    }
  } else if (current) {
    throw new MemoryError('REVISION_CONFLICT', '同一事实已存在，请读取后修订。');
  }
  if (input.action !== 'create' && !input.target) {
    throw new MemoryError('INVALID_INPUT', '修订必须指定记忆与版本。');
  }
  if (input.action === 'create' && input.target) {
    throw new MemoryError('INVALID_INPUT', '新建不能携带修订目标。');
  }
  if (input.action === 'supersede' && current) {
    tx.supersede(current.indexId, 0);
  }
  const sources = [
    ...new Map([...(current?.sources ?? []), ...input.sources].map((s) => [sourceKey(s), s])).values(),
  ].slice(-20);
  const document = tx.save(
    { ...input, canonicalKey: key, sources },
    input.action === 'supersede' ? undefined : current?.indexId
  );
  if (input.action === 'supersede' && current) {
    tx.supersede(current.indexId, document.indexId);
  }
  if (!guard) {
    tx.fence(hash('canonical:' + key), false);
  }
  const updated = tx.advance();
  const receipt: MemoryReceipt = {
    requestId: input.requestId,
    action: input.action,
    status: 'committed',
    revision: updated.revision,
    ref: { storeId: meta.storeId, indexId: document.indexId },
  };
  tx.record(hash(JSON.stringify(input)), receipt);
  return receipt;
}
