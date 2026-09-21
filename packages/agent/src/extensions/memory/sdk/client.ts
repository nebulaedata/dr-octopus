/**
 * @author Codex
 * @description Lightweight asynchronous Memory client; SQLite is loaded only by the shared daemon.
 */
import { access } from 'node:fs/promises';
import { memoryReadSchema, memoryRecallSchema } from '@octopus/shared/protocol/memory';
import { resolveMemoryPaths } from '../lib/paths.js';
import { memoryProfile } from '../lib/profile.js';
import { MemoryError } from '../definitions/error.js';
import { discoverMemory, memoryRequest } from './transport.js';
import { getMemoryServiceStatus, startMemoryService } from './lifecycle.js';
import { exportRemoteWiki } from './export.js';
import type { MemoryService } from '../services/memory-service.js';
import type { MemoryStatus, MemoryPage, MemoryReadResult } from '../definitions/types.js';
import type { CurationStep } from '../daemon/curation.js';

/**
 * Construct only local client state. Disposal cancels this client, never the shared service.
 */
export function createMemoryClient(
  options: { dataRoot?: string; migrationsFolder?: string; readOnly?: boolean } = {}
): MemoryService {
  const lifetime = new AbortController();
  const tickets = new Set<string>();
  let starting: Promise<unknown> | undefined;
  /**
   * Release a continuation without starting or resurrecting a stopped daemon.
   */
  async function cancelTicket(id: string): Promise<void> {
    tickets.delete(id);
    try {
      const profile = await memoryProfile(options.dataRoot);
      if (!profile) {
        return;
      }
      const endpoint = await discoverMemory(profile);
      if (endpoint) {
        await memoryRequest(
          profile,
          endpoint,
          'call',
          { operation: 'curationCancel', input: id },
          undefined,
          1000
        );
      }
    } catch {
      // The daemon expires abandoned tickets; uncertain writes are never replayed here.
    }
  }
  /**
   * Enforce host capability before discovery or starting a service.
   */
  function writable() {
    if (options.readOnly) {
      throw new MemoryError('READ_ONLY', '此 Agent 只能读取记忆。');
    }
  }
  /**
   * Keep empty-store reads lazy while routing all existing-store access through its owner.
   */
  async function exists() {
    lifetime.signal.throwIfAborted();
    if (starting) {
      await starting;
    }
    const status = await getMemoryServiceStatus(options.dataRoot);
    if (status.autostartSuppressed) {
      throw new MemoryError('MEMORY_SERVICE_STOPPED', '记忆服务已停止，请在系统设置 → 记忆中启动。');
    }
    try {
      await access(resolveMemoryPaths(options.dataRoot).databasePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }
  /**
   * Coalesce local startup; the native lifetime lock arbitrates starts from different processes.
   */
  async function call<T>(
    operation: string,
    input?: unknown,
    maxBytes?: number,
    signal?: AbortSignal,
    epoch?: number
  ): Promise<T> {
    lifetime.signal.throwIfAborted();
    signal?.throwIfAborted();
    starting ??= startMemoryService(
      options.dataRoot,
      30_000,
      false,
      undefined,
      options.migrationsFolder,
      lifetime.signal
    ).finally(() => {
      starting = undefined;
    });
    await starting;
    const profile = (await memoryProfile(options.dataRoot))!;
    const endpoint = await discoverMemory(profile);
    if (!endpoint) {
      throw new MemoryError('STORE_UNAVAILABLE', '记忆服务不可用，请稍后重试。');
    }
    try {
      return await memoryRequest<T>(
        profile,
        endpoint,
        'call',
        { operation, input, maxBytes, epoch },
        AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])])
      );
    } catch (error) {
      if (error instanceof MemoryError) {
        throw error;
      }
      if (lifetime.signal.aborted || signal?.aborted) {
        throw new MemoryError('CANCELLED', '记忆操作已取消。');
      }
      throw new MemoryError('STORE_UNAVAILABLE', '记忆服务连接中断；写入结果请刷新确认。', { cause: error });
    }
  }
  const service: MemoryService = {
    initialize: async () => {
      writable();
      return call<MemoryStatus>('initialize');
    },
    getStatus: async () => {
      if (!(await exists())) {
        return {
          version: 1,
          mode: 'auto',
          revision: 0,
          writeEpoch: 0,
          count: 0,
          availability: 'uninitialized',
        };
      }
      const result = await call<MemoryStatus>('getStatus');
      return options.readOnly ? { ...result, availability: 'read-only' } : result;
    },
    recall: async (input, maxBytes) => {
      if (!memoryRecallSchema.safeParse(input).success) {
        throw new MemoryError('INVALID_INPUT', '记忆参数无效。');
      }
      return (await exists())
        ? call<MemoryPage>('recall', input, maxBytes)
        : { version: 1, action: 'recall', items: [], revision: 0, exhausted: true, complete: true };
    },
    read: async (input, maxBytes) => {
      const value = memoryReadSchema.safeParse(input);
      if (!value.success) {
        throw new MemoryError('INVALID_INPUT', '记忆参数无效。');
      }
      return (await exists())
        ? call<MemoryReadResult>('read', input, maxBytes)
        : {
            version: 1,
            action: 'read',
            complete: true,
            items: value.data.refs.map((ref) => ({ ref, error: 'NOT_FOUND' })),
          };
    },
    hasMissing: async (refs) => ((await exists()) ? call<boolean>('hasMissing', refs) : true),
    remember: async (input, guard) => {
      writable();
      return call('remember', input, undefined, guard?.signal, guard?.epoch);
    },
    forget: async (input) => {
      writable();
      return call('forget', input);
    },
    setPolicy: async (input) => {
      writable();
      return call('setPolicy', input);
    },
    rebuildFts: async () => {
      writable();
      return call('rebuildFts');
    },
    exportWiki: () => exportRemoteWiki(service),
    /**
     * Evaluate locally, then resume the daemon's fenced transaction using a short-lived opaque ticket.
     */
    async evaluateRun(sources, curator, signal, explicit = false) {
      writable();
      const combined = AbortSignal.any([signal, lifetime.signal]);
      let ticket: string | undefined;
      try {
        let step = await call<CurationStep>('curationBegin', { sources, explicit }, undefined, combined);
        ticket = step.id;
        tickets.add(ticket);
        while (!step.done) {
          const proposals = await curator(step.input, combined);
          combined.throwIfAborted();
          step = await call<CurationStep>(
            'curationNext',
            { id: ticket, proposals: proposals.slice(0, 5) },
            undefined,
            combined
          );
        }
        return step.receipts;
      } finally {
        if (ticket) {
          await cancelTicket(ticket);
        }
      }
    },
    dispose: () => {
      lifetime.abort();
      return Promise.all([...tickets].map(cancelTicket)).then(() => undefined);
    },
  };
  return service;
}
