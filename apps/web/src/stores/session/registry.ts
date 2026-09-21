/**
 * @author Codex
 * @description 管理浏览器标签页中按 Session 隔离的 Zustand vanilla stores
 */

import { createSessionStore } from './store';
import type { SessionStoreApi } from './store';
import type { SessionStoreRegistryOptions } from './type';

export class SessionStoreRegistry {
  readonly #stores = new Map<string, SessionStoreApi>();
  readonly #lastAccessed = new Map<string, number>();
  readonly #idleSince = new Map<string, number>();
  readonly #idleTtlMs: number;
  readonly #maxStores: number;

  /**
   * 创建 registry，可配置 idle 清理策略。
   * @param options 配置项，包括 idle TTL 和最大存储数量。
   * @param options.idleTtlMs 超过此毫秒数未访问的 Store 将被清理，默认 5 分钟。
   * @param options.maxStores 超过此数量的 Store 将按 LRU 回收，默认 16。
   */
  public constructor(options?: SessionStoreRegistryOptions) {
    this.#idleTtlMs = options?.idleTtlMs ?? 5 * 60_000;
    this.#maxStores = options?.maxStores ?? 16;
  }

  /**
   * 返回现有 Store 或创建新 Store，并更新活跃时间戳。
   */
  public ensure(sessionId: string): SessionStoreApi {
    this.#idleSince.delete(sessionId);
    this.#lastAccessed.set(sessionId, Date.now());
    const existing = this.#stores.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const store = createSessionStore(sessionId);
    this.#stores.set(sessionId, store);
    return store;
  }

  /**
   * 将一个 Store 标记为 idle，开始计算清理 TTL。
   */
  public markIdle(sessionId: string): void {
    if (this.#stores.has(sessionId) && !this.#idleSince.has(sessionId)) {
      this.#idleSince.set(sessionId, Date.now());
    }
  }

  /**
   * 清理超过 idle TTL 的 Store，并在超过容量上限时按 LRU 回收 idle Store。
   */
  public cleanup(): void {
    const now = Date.now();
    for (const [sessionId, idleSince] of this.#idleSince) {
      if (now - idleSince >= this.#idleTtlMs) {
        this.#remove(sessionId);
      }
    }
    if (this.#stores.size > this.#maxStores) {
      this.#evictLruIdle();
    }
  }

  /**
   * 从所有索引中彻底移除一个 Store。
   */
  #remove(sessionId: string): void {
    this.#stores.delete(sessionId);
    this.#idleSince.delete(sessionId);
    this.#lastAccessed.delete(sessionId);
  }

  /**
   * 按 idle 开始时间从老到新回收，直到 Store 数量回到上限以下。
   */
  #evictLruIdle(): void {
    const candidates = [...this.#idleSince.entries()].sort(([, left], [, right]) => left - right);
    const excess = this.#stores.size - this.#maxStores;
    for (let index = 0; index < Math.min(excess, candidates.length); index += 1) {
      this.#remove(candidates[index][0]);
    }
  }
}

export const sessionStores = new SessionStoreRegistry();
