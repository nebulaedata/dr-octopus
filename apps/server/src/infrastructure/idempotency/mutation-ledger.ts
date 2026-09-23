/**
 * @author Codex
 * @description Single-flights and replays bounded mutation results by caller-provided idempotency identity.
 */

import { ApplicationError } from '../errors/application-error.js';

export interface MutationIdentity {
  scope: string;
  key: string;
  type: string;
  fingerprint: string;
}

export interface MutationLedgerOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface MutationEntry<T = unknown> {
  type: string;
  fingerprint: string;
  state: 'pending' | 'succeeded' | 'failed';
  promise: Promise<T>;
  createdAt: number;
  expiresAt: number;
}

/**
 * Keeps a process-local bounded replay ledger for transport retries and duplicate delivery.
 */
export class MutationIdempotencyLedger {
  readonly #entries = new Map<string, MutationEntry>();
  readonly #maxEntries: number;
  readonly #ttlMs: number;
  readonly #now: () => number;

  /**
   * Creates a bounded ledger with deterministic policy dependencies.
   *
   * @param options Capacity, expiry, and clock policy.
   */
  public constructor(options: MutationLedgerOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 10_000;
    this.#ttlMs = options.ttlMs ?? 15 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Executes a mutation once or replays the exact pending/settled result.
   *
   * @param identity Stable scope, request key, mutation type, and payload fingerprint.
   * @param operation Side effect executed only for the first matching request.
   * @returns First execution result or its replay.
   */
  public execute<T>(identity: MutationIdentity, operation: () => Promise<T>): Promise<T> {
    this.#prune();
    const ledgerKey = `${identity.scope}\u0000${identity.key}`;
    const existing = this.#entries.get(ledgerKey) as MutationEntry<T> | undefined;
    if (existing !== undefined) {
      if (existing.type !== identity.type || existing.fingerprint !== identity.fingerprint) {
        throw new ApplicationError(
          'MUTATION_IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used for a different mutation.',
          { statusCode: 409 }
        );
      }
      return existing.promise;
    }
    this.#ensureCapacity();
    const createdAt = this.#now();
    const promise = Promise.resolve().then(operation);
    const entry: MutationEntry<T> = {
      type: identity.type,
      fingerprint: identity.fingerprint,
      state: 'pending',
      promise,
      createdAt,
      expiresAt: createdAt + this.#ttlMs,
    };
    this.#entries.set(ledgerKey, entry);
    void promise.then(
      () => {
        entry.state = 'succeeded';
      },
      () => {
        entry.state = 'failed';
      }
    );
    return promise;
  }

  /**
   * Removes expired settled entries without evicting in-flight mutation ownership.
   */
  #prune(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.state !== 'pending' && entry.expiresAt <= now) {
        this.#entries.delete(key);
      }
    }
  }

  /**
   * Evicts the oldest settled entry or applies backpressure when every entry is pending.
   */
  #ensureCapacity(): void {
    if (this.#entries.size < this.#maxEntries) {
      return;
    }
    const settled = [...this.#entries.entries()]
      .filter(([, entry]) => entry.state !== 'pending')
      .sort(([, left], [, right]) => left.createdAt - right.createdAt)[0];
    if (settled !== undefined) {
      this.#entries.delete(settled[0]);
      return;
    }
    throw new ApplicationError(
      'MUTATION_IDEMPOTENCY_CAPACITY',
      'The mutation idempotency ledger is at capacity.',
      { statusCode: 429 }
    );
  }
}

/**
 * Creates a deterministic fingerprint for JSON-compatible mutation input.
 *
 * @param value Mutation input value.
 * @returns Canonical JSON representation with sorted object keys.
 */
export function mutationFingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Recursively sorts object keys while preserving array order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}
