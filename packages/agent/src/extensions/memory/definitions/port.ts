/**
 * @author Codex
 * @description Transaction-bound storage ports consumed by memory use cases.
 */
import type { MemoryDocument, MemoryFact, MemoryIndex, MemoryMode, MemoryReceipt } from './types.js';
export interface MemoryMeta {
  storeId: string;
  mode: MemoryMode;
  revision: number;
  activationCounter: number;
  writeEpoch: number;
}
export interface MemoryTransaction {
  /**
   * Read current database identity and version in this transaction.
   */
  meta(): MemoryMeta;
  /**
   * Replace the derived FTS rows atomically from active indexes without changing facts.
   */
  rebuildFts(): void;
  /**
   * Count active facts.
   */
  count(): number;
  /**
   * Read a fact including its section and sources.
   */
  get(id: number): MemoryDocument | undefined;
  /**
   * Find the current fact for a canonical subject.
   */
  canonical(key: string): MemoryDocument | undefined;
  /**
   * Read ordered active indexes, optionally before a sequence.
   */
  page(before: number | undefined, limit: number): MemoryIndex[];
  /**
   * Locate active indexes with a bounded FTS expression.
   */
  search(query: string): MemoryIndex[];
  /**
   * Insert or replace one section and its index, using a fresh activation sequence.
   */
  save(fact: MemoryFact, id?: number): MemoryDocument;
  /**
   * Mark a prior fact as replaced by a newer record.
   */
  supersede(id: number, replacement: number): void;
  /**
   * Delete all versions of a canonical fact, returning deleted documents.
   */
  remove(key: string): MemoryDocument[];
  /**
   * Inspect a deletion fence.
   */
  blocked(hash: string): boolean;
  /**
   * Write or explicitly clear one deletion fence.
   */
  fence(hash: string, enabled: boolean): void;
  /**
   * Read an earlier idempotent request.
   */
  receipt(id: string): { hash: string; receipt: MemoryReceipt } | undefined;
  /**
   * Persist a minimal successful receipt.
   */
  record(hash: string, receipt: MemoryReceipt): void;
  /**
   * Increment the database revision and optionally change policy or invalidate pending writers.
   */
  advance(input?: { mode?: MemoryMode; fence?: boolean }): MemoryMeta;
}
export interface MemoryRepository {
  /**
   * Run a short read transaction; absent storage is undefined and causes no creation.
   */
  read<T>(work: (tx: MemoryTransaction) => T): Promise<T | undefined>;
  /**
   * Initialize and run a short immediate write transaction with bounded busy retries.
   */
  write<T>(work: (tx: MemoryTransaction) => T, signal?: AbortSignal): Promise<T>;
  /**
   * Close resources; no work may follow disposal.
   */
  dispose(): Promise<void>;
}
