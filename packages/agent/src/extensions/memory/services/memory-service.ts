/**
 * @author Codex
 * @description Host-neutral global memory use cases shared by TUI, RPC and HTTP.
 */
import {
  memoryForgetSchema,
  memoryPolicySchema,
  memoryReadSchema,
  memoryRecallSchema,
  memoryRememberSchema,
} from '@octopus/shared/protocol/memory';
import { exportWiki } from './maintenance-service.js';
import { curateRun } from './curator-service.js';
import { MemoryError } from '../definitions/error.js';
import { applyRemember, priorReceipt, sourceKey } from './mutation-service.js';
import { recall, read, missing } from './recall-service.js';
import type { MemoryHash } from './mutation-service.js';
import type { MemoryRepository } from '../definitions/port.js';
import type {
  MemoryStatus,
  MemoryRef,
  MemorySource,
  MemoryCurator,
  MemoryWriteGuard,
  MemoryReceipt,
  MemoryPage,
  MemoryReadResult,
} from '../definitions/types.js';
/**
 * Construct reusable application rules without opening storage or capturing a Pi Session.
 */
export function memoryService(repository: MemoryRepository, hash: MemoryHash, readOnly = false) {
  /**
   * Validate external data and present a safe domain error.
   */
  function parse<T>(
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    value: unknown
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new MemoryError('INVALID_INPUT', '记忆参数无效或超过长度限制。');
    }
    return result.data;
  }
  /**
   * Enforce the host's capability independently of globally persisted policy.
   */
  function writable() {
    if (readOnly) {
      throw new MemoryError('READ_ONLY', '此 Agent 只能读取记忆。');
    }
  }
  const service = {
    /**
     * Export an explicit Markdown copy without adding tools or model context.
     */
    exportWiki: () => exportWiki(repository),
    /**
     * Repair derived search content; facts and policy remain authoritative.
     */
    async rebuildFts() {
      writable();
      await repository.write((tx) => tx.rebuildFts());
      return service.getStatus();
    },
    /**
     * Observe storage without creating it.
     */
    async getStatus(): Promise<MemoryStatus> {
      return (
        (await repository.read((tx) => ({
          ...tx.meta(),
          version: 1 as const,
          count: tx.count(),
          availability: readOnly ? ('read-only' as const) : ('ready' as const),
        }))) ?? {
          version: 1,
          mode: 'auto',
          revision: 0,
          writeEpoch: 0,
          count: 0,
          availability: 'uninitialized',
        }
      );
    },
    /**
     * Initialize an ordinary Agent's default global memory store.
     */
    async initialize() {
      writable();
      await repository.write(() => undefined);
      return service.getStatus();
    },
    /**
     * Provide a bounded global directory or FTS candidates.
     */
    async recall(input: unknown, maxBytes = 9000): Promise<MemoryPage> {
      const value = parse(memoryRecallSchema, input);
      return (
        (await repository.read((tx) => recall(tx, value, maxBytes))) ?? {
          version: 1,
          action: 'recall',
          items: [],
          revision: 0,
          exhausted: true,
          complete: true,
        }
      );
    },
    /**
     * Read only active sections with explicit missing-reference results.
     */
    async read(input: unknown, maxBytes = 14000): Promise<MemoryReadResult> {
      const value = parse(memoryReadSchema, input);
      return (
        (await repository.read((tx) => read(tx, value, maxBytes))) ?? {
          version: 1,
          action: 'read',
          complete: true,
          items: value.refs.map((ref) => ({ ref, error: 'NOT_FOUND' })),
        }
      );
    },
    /**
     * Check whether old model-visible results contain removed facts.
     */
    async hasMissing(refs: MemoryRef[]) {
      return (await repository.read((tx) => missing(tx, refs))) ?? true;
    },
    /**
     * Persist an explicit user fact or a guarded Curator candidate.
     */
    async remember(input: unknown, guard?: MemoryWriteGuard) {
      writable();
      const value = parse(memoryRememberSchema, input);
      return repository.write((tx) => applyRemember(tx, value, hash, guard), guard?.signal);
    },
    /**
     * Atomically delete all versions and prevent stale or replayed sources from restoring them.
     */
    async forget(input: unknown): Promise<MemoryReceipt> {
      writable();
      const value = parse(memoryForgetSchema, input);
      return repository.write((tx) => {
        const prior = priorReceipt(tx, value.requestId, value, hash);
        if (prior) {
          return prior;
        }
        const meta = tx.meta();
        const target = value.ref.storeId === meta.storeId ? tx.get(value.ref.indexId) : undefined;
        if (!target) {
          throw new MemoryError('NOT_FOUND', '记忆已删除。');
        }
        if (target.revision !== value.expectedRevision) {
          throw new MemoryError('REVISION_CONFLICT', '记忆已更新，请刷新后重试。');
        }
        for (const doc of tx.remove(target.canonicalKey)) {
          tx.fence(hash('canonical:' + doc.canonicalKey), true);
          for (const source of doc.sources) {
            tx.fence(hash(sourceKey(source)), true);
          }
        }
        const updated = tx.advance({ fence: true });
        const receipt: MemoryReceipt = {
          requestId: value.requestId,
          action: 'forget',
          status: 'committed',
          revision: updated.revision,
        };
        tx.record(hash(JSON.stringify(value)), receipt);
        return receipt;
      });
    },
    /**
     * Change one global policy and invalidate any pending inference.
     */
    async setPolicy(input: unknown): Promise<MemoryReceipt> {
      writable();
      const value = parse(memoryPolicySchema, input);
      return repository.write((tx) => {
        const prior = priorReceipt(tx, value.requestId, value, hash);
        if (prior) {
          return prior;
        }
        if (tx.meta().revision !== value.expectedRevision) {
          throw new MemoryError('REVISION_CONFLICT', '记忆已更新，请刷新后重试。');
        }
        const updated = tx.advance({ mode: value.mode, fence: true });
        const receipt: MemoryReceipt = {
          requestId: value.requestId,
          action: 'policy',
          status: 'committed',
          revision: updated.revision,
        };
        tx.record(hash(JSON.stringify(value)), receipt);
        return receipt;
      });
    },
    /**
     * Curate new evidenced user entries once, atomically applying a bounded batch.
     */
    async evaluateRun(
      sources: MemorySource[],
      curator: MemoryCurator,
      signal: AbortSignal,
      explicit = false
    ) {
      writable();
      return curateRun(repository, hash, sources, curator, signal, explicit);
    },
    /**
     * Close this Service without mutating global policy.
     */
    dispose: () => repository.dispose(),
  };
  return service;
}
export type MemoryService = ReturnType<typeof memoryService>;
