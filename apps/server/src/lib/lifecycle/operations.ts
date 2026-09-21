/**
 * @author Codex
 * @description Retains bounded restart idempotency records across runtime replacement.
 */
import { controlError } from './control.js';
import type { RestartOperationDto, RestartServerBody } from '@octopus/shared/protocol';

export interface RestartRecord {
  body: RestartServerBody;
  operation: RestartOperationDto;
  /**
   * Releases a response-held operation at most once.
   */
  handoff(this: void): void;
}

/**
 * Keeps active and replayable operations until their fixed terminal retention expires.
 */
export class RestartHistory {
  private records = new Map<string, RestartRecord>();
  /**
   * Expires terminal entries while preserving all active records.
   */
  private prune(): void {
    for (const [key, record] of this.records) {
      if (record.operation.completedAt && Date.now() - Date.parse(record.operation.completedAt) >= 600_000) {
        this.records.delete(key);
      }
    }
  }
  /**
   * Checks replay before checking the current runtime generation.
   */
  find(key: string, body: RestartServerBody): RestartRecord | undefined {
    this.prune();
    const record = this.records.get(key);
    if (
      record &&
      (record.body.revision !== body.revision ||
        record.body.expectedServiceInstanceId !== body.expectedServiceInstanceId)
    ) {
      throw controlError('SERVER_RESTART_KEY_CONFLICT', 'This key belongs to another restart request.');
    }
    return record;
  }
  /**
   * Reserves capacity without evicting valid replay records.
   */
  assertCapacity(): void {
    this.prune();
    if (this.records.size >= 100) {
      throw controlError('SERVER_RESTART_HISTORY_FULL', 'Restart history is full. Try again later.', 429);
    }
  }
  /**
   * Registers an accepted operation before handing off the HTTP response.
   */
  add(key: string, record: RestartRecord): void {
    this.records.set(key, record);
  }
  /**
   * Returns a detached operation, never mutable Host state.
   */
  get(id: string): RestartOperationDto {
    this.prune();
    for (const record of this.records.values()) {
      if (record.operation.operationId === id) {
        return structuredClone(record.operation);
      }
    }
    throw controlError('SERVER_RESTART_OPERATION_NOT_FOUND', 'Restart result is unknown or expired.', 404);
  }
}

/**
 * Limits waiting without claiming that the underlying resource has been cancelled.
 */
export async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Lifecycle deadline exceeded')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
