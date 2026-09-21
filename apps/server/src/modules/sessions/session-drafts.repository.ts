/**
 * @author Codex
 * @description Stores unpublished Session metadata in memory so prewarmed home drafts never enter SQLite catalogs.
 */
import type { NewSessionRow, SessionRow } from '../../db/schema.js';

/**
 * Owns temporary metadata only; the runtime coordinator remains the owner of Agent processes.
 */
export class SessionDraftsRepository {
  readonly #rows = new Map<string, SessionRow>();

  /**
   * Initializes the same preference defaults as a persisted catalog row without writing to SQLite.
   */
  public create(input: NewSessionRow): SessionRow {
    const row: SessionRow = {
      ...input,
      kind: 'agent',
      provider: input.provider ?? null,
      model: input.model ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      steeringMode: input.steeringMode ?? 'one-at-a-time',
      followUpMode: input.followUpMode ?? 'one-at-a-time',
      autoCompactionEnabled: input.autoCompactionEnabled ?? true,
      autoRetryEnabled: input.autoRetryEnabled ?? true,
      lastActiveAt: input.lastActiveAt ?? null,
      lastMessageAt: input.lastMessageAt ?? null,
      pinnedAt: null,
      notificationVersion: 0,
      readVersion: 0,
      execution: null,
    };
    this.#rows.set(row.id, row);
    return row;
  }

  /**
   * Returns a copy so callers cannot mutate draft ownership outside the repository.
   */
  public get(id: string): SessionRow | undefined {
    const row = this.#rows.get(id);
    return row === undefined ? undefined : { ...row };
  }

  /**
   * Updates a draft when it exists, allowing the catalog repository to otherwise use SQLite.
   */
  public update(id: string, values: Partial<SessionRow>): boolean {
    const row = this.#rows.get(id);
    if (row === undefined) {
      return false;
    }
    this.#rows.set(id, { ...row, ...values, id });
    return true;
  }

  /**
   * Removes only unpublished metadata, after promotion or runtime cleanup has succeeded.
   */
  public delete(id: string): boolean {
    return this.#rows.delete(id);
  }

  /**
   * Exposes copies to the lifecycle owner for bounded cleanup, never to the Session list endpoint.
   */
  public list(): SessionRow[] {
    return [...this.#rows.values()].map((row) => ({ ...row }));
  }
}
