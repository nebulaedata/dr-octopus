/**
 * @author Codex
 * @description Expose global Agent memory through the Host's existing HTTP error and lifecycle contracts.
 */
import {
  createMemoryService,
  MemoryError,
  getMemoryServiceStatus,
  startMemoryService,
  stopMemoryService,
  restartMemoryService,
} from '@octopus/agent';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type {
  MemoryRecall,
  MemoryRead,
  MemoryRemember,
  MemoryForget,
  MemoryPolicy,
} from '@octopus/shared/protocol/memory';

export class MemoryService {
  /**
   * Stream a user-requested global Markdown copy.
   */
  exportWiki() {
    return this.memory.exportWiki();
  }
  /**
   * Rebuild derived search rows without editing remembered facts.
   */
  rebuildFts() {
    return this.call(() => this.memory.rebuildFts());
  }
  private readonly memory;
  /**
   * Own a lazy SDK instance; reads never initialize storage or spawn an Agent.
   */
  constructor(
    server: FastifyInstance,
    private readonly options: { dataRoot?: string } = {}
  ) {
    this.memory = createMemoryService(options);
    server.addHook('onClose', () => this.memory.dispose());
  }
  /**
   * Observe without starting, or explicitly control the Agent-owned global daemon.
   */
  lifecycle(action: 'status' | 'start' | 'stop' | 'restart') {
    const operations = {
      status: getMemoryServiceStatus,
      start: startMemoryService,
      stop: stopMemoryService,
      restart: restartMemoryService,
    };
    return this.call(() => operations[action](this.options.dataRoot));
  }
  /**
   * Translate safe domain errors at the transport boundary.
   */
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof MemoryError) {
        throw new ApplicationError(error.code, error.message, {
          statusCode:
            error.code === 'NOT_FOUND'
              ? 404
              : error.code === 'READ_ONLY'
                ? 403
                : error.code.includes('CONFLICT') || error.code === 'CURSOR_STALE'
                  ? 409
                  : error.code === 'INVALID_INPUT'
                    ? 400
                    : 503,
          retryable: error.code === 'STORE_UNAVAILABLE',
        });
      }
      throw error;
    }
  }
  /**
   * Observe global policy and store availability.
   */
  status() {
    return this.call(() => this.memory.getStatus());
  }
  /**
   * List global navigation or bounded search candidates.
   */
  indexes(input: MemoryRecall) {
    return this.call(() => this.memory.recall(input));
  }
  /**
   * Read fact sections with revision-bound continuation.
   */
  read(input: MemoryRead) {
    return this.call(() => this.memory.read(input, 128000));
  }
  /**
   * Commit explicit user-authored memory without model inference.
   */
  remember(input: MemoryRemember) {
    return this.call(() => this.memory.remember(input));
  }
  /**
   * Delete a fact and all versions under its current revision.
   */
  forget(input: MemoryForget) {
    return this.call(() => this.memory.forget(input));
  }
  /**
   * Update the single global curation policy.
   */
  policy(input: MemoryPolicy) {
    return this.call(() => this.memory.setPolicy(input));
  }
}
