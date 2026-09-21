/**
 * @author Codex
 * @description Bounded daemon-owned curation continuations preserving transaction fences across remote model calls.
 */
import { randomUUID } from 'node:crypto';
import { curationSteps } from '../services/curator-service.js';
import { MemoryError } from '../definitions/error.js';
import type { MemoryRepository } from '../definitions/port.js';
import type { MemoryHash } from '../services/mutation-service.js';
import type { MemorySource, MemoryRemember } from '../definitions/types.js';

/**
 * Retain only short-lived model contexts, never open transactions, while the client runs its own model.
 */
export function createCurationSessions(repository: MemoryRepository, hash: MemoryHash) {
  const sessions = new Map<
    string,
    {
      steps: ReturnType<typeof curationSteps>;
      controller: AbortController;
      timer: ReturnType<typeof setTimeout>;
      busy: boolean;
    }
  >();
  /**
   * Cancel expired, disconnected or explicitly disposed inference without changing global policy.
   */
  async function cancel(id: string) {
    const session = sessions.get(id);
    if (!session) {
      return;
    }
    sessions.delete(id);
    clearTimeout(session.timer);
    session.controller.abort();
    await session.steps.return([]);
  }
  /**
   * Advance at most once per model response; the generator validates evidence, revisions and epochs.
   */
  async function next(id: string, proposals?: MemoryRemember[], signal?: AbortSignal) {
    const session = sessions.get(id);
    if (!session) {
      throw new MemoryError('CANCELLED', '记忆整理已过期，请重新执行。');
    }
    if (session.busy) {
      throw new MemoryError('REVISION_CONFLICT', '记忆整理请求正在执行。');
    }
    session.busy = true;
    const abort = () => session.controller.abort();
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await session.steps.next(proposals!);
      if (result.done) {
        await cancel(id);
      }
      return result.done
        ? { id, done: true as const, receipts: result.value }
        : { id, done: false as const, input: result.value };
    } catch (error) {
      await cancel(id);
      throw error;
    } finally {
      session.busy = false;
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    /**
     * Bound retained contexts even if a client exits before receiving its ticket.
     */
    async begin(sources: MemorySource[], explicit: boolean, signal: AbortSignal) {
      if (sessions.size >= 64) {
        throw new MemoryError('STORE_UNAVAILABLE', '记忆整理繁忙。');
      }
      const id = randomUUID();
      const controller = new AbortController();
      const timer = setTimeout(() => {
        void cancel(id);
      }, 30_000);
      timer.unref();
      sessions.set(id, {
        steps: curationSteps(repository, hash, sources, controller.signal, explicit),
        controller,
        timer,
        busy: false,
      });
      return next(id, undefined, signal);
    },
    next,
    cancel,
    close: async () => {
      await Promise.all([...sessions.keys()].map(cancel));
    },
  };
}
export type CurationStep = Awaited<ReturnType<ReturnType<typeof createCurationSessions>['next']>>;
