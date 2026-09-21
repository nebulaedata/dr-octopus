/**
 * @author Codex
 * @description Coordinates idempotent home prewarming and reclaims abandoned, unpublished Session runtimes.
 */
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { SessionsRepository } from './sessions.repository.js';
import type { SessionRuntimeCoordinator } from '../../lib/runtime/index.js';
import type { SessionDto } from '@octopus/shared/protocol';

export interface SessionDraftsServiceOptions {
  repository: SessionsRepository;
  runtime: SessionRuntimeCoordinator;
  /**
   * Creates or reactivates the exact requested draft through the existing serialized coordinator.
   */
  prepare(workspaceId: string, draftId: string): Promise<SessionDto>;
  /**
   * Stops an owned draft and removes its Session artifacts.
   */
  remove(sessionId: string): Promise<unknown>;
  /**
   * Reports bounded background cleanup failures to the Host logger.
   */
  onError(error: unknown): void;
}

/**
 * Keeps per-browser drafts distinct while sharing repeated requests for one draft identity.
 */
export class SessionDraftsService {
  readonly #pending = new Map<string, { workspaceId: string; result: Promise<SessionDto> }>();
  readonly #retiring = new Set<string>();
  readonly #timer: NodeJS.Timeout;
  #cleanup: Promise<void> | undefined;
  #closed = false;

  /**
   * Starts unreferenced maintenance; live subscriptions protect drafts from idle reclamation.
   */
  public constructor(private readonly options: SessionDraftsServiceOptions) {
    this.#timer = setInterval(() => {
      void this.reap().catch((error) => options.onError(error));
    }, 60_000);
    this.#timer.unref();
  }

  /**
   * Shares one in-flight warmup per workspace and validated opaque browser draft ID.
   */
  public prepare(workspaceId: string, draftId: string): Promise<SessionDto> {
    this.assertAvailable(draftId);
    if (this.#closed) {
      throw new ApplicationError('SESSION_DRAFT_CLOSED', 'Session preparation is unavailable.', {
        statusCode: 503,
      });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)) {
      throw new ApplicationError('INVALID_SESSION_DRAFT', 'A valid draft identity is required.', {
        statusCode: 400,
      });
    }
    if (
      this.options.repository.get(draftId) === undefined &&
      this.options.runtime
        .getDiagnostics()
        .slots.some((slot) => slot.sessionId === draftId && slot.canonicalSessionPath !== undefined) &&
      !this.#pending.has(draftId)
    ) {
      throw new ApplicationError('SESSION_DRAFT_EXPIRED', 'Prepare a new conversation and try again.', {
        statusCode: 409,
      });
    }
    const key = draftId;
    const pending = this.#pending.get(key);
    if (pending !== undefined) {
      if (pending.workspaceId !== workspaceId) {
        throw new ApplicationError('SESSION_DRAFT_CONFLICT', 'Draft belongs to another workspace.', {
          statusCode: 409,
        });
      }
      return pending.result;
    }
    if (
      this.options.repository.get(draftId) === undefined &&
      this.#pending.size + this.options.repository.listDrafts().length >= 64
    ) {
      throw new ApplicationError(
        'SESSION_DRAFT_CAPACITY',
        'Too many prepared conversations. Try again later.',
        { statusCode: 429 }
      );
    }
    const preparation = this.options.prepare(workspaceId, draftId).finally(() => this.#pending.delete(key));
    this.#pending.set(key, { workspaceId, result: preparation });
    return preparation;
  }

  /**
   * Reclaims drafts unused for fifteen minutes, retaining any active subscription or runtime operation.
   */
  public reap(now = Date.now()): Promise<void> {
    if (this.#cleanup !== undefined) {
      return this.#cleanup;
    }
    const cleanup = this.#reap(now).finally(() => {
      this.#cleanup = undefined;
    });
    this.#cleanup = cleanup;
    return cleanup;
  }

  /**
   * Checks interest again before removal so a connected Composer keeps its warmed runtime and metadata.
   */
  async #reap(now: number): Promise<void> {
    for (const row of this.options.repository.listDrafts()) {
      if (now - Date.parse(row.lastActiveAt ?? row.createdAt) < 15 * 60_000) {
        continue;
      }
      const slot = this.options.runtime
        .getDiagnostics()
        .slots.find((candidate) => candidate.sessionId === row.id);
      if (
        slot !== undefined &&
        (slot.demandCount > 0 || slot.state === 'activating' || slot.state === 'draining')
      ) {
        continue;
      }
      if (!this.options.repository.get(row.id)?.isDraft) {
        continue;
      }
      this.#retiring.add(row.id);
      try {
        await this.options.remove(row.id);
      } finally {
        this.#retiring.delete(row.id);
      }
    }
  }

  /**
   * Stops maintenance immediately, including when tests dispose services without closing a full Host.
   */
  public dispose(): void {
    this.#closed = true;
    clearInterval(this.#timer);
  }

  /**
   * Rejects promotion or reuse once cleanup has claimed the unpublished runtime.
   */
  public assertAvailable(sessionId: string): void {
    if (this.#retiring.has(sessionId) || this.#closed) {
      throw new ApplicationError('SESSION_DRAFT_EXPIRED', 'Prepare a new conversation and try again.', {
        statusCode: 409,
      });
    }
  }

  /**
   * Waits for accepted preparations and removes remaining unpublished artifacts before Host shutdown.
   */
  public async close(): Promise<void> {
    this.dispose();
    await Promise.allSettled([...this.#pending.values()].map((pending) => pending.result));
    await this.#cleanup;
    for (const row of this.options.repository.listDrafts()) {
      await this.options.remove(row.id);
    }
  }
}
