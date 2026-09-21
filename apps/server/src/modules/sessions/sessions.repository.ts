/**
 * @author Codex
 * @description 通过 Drizzle 持久化 Dr.Octopus Session 控制面映射、元数据与偏好
 */

import { and, desc, eq, isNotNull, like, or } from 'drizzle-orm';
import { MAX_PINNED_SESSIONS } from '@octopus/shared/protocol';
import { sessions } from '../../db/schema.js';
import { SessionDraftsRepository } from './session-drafts.repository.js';
import { toSessionDto } from './sessions.utils.js';
import type { OctopusDatabase } from '../../db/client.js';
import type { NewSessionRow, SessionRow } from '../../db/schema.js';
import type { SessionDto, SessionPreferencesDto } from '@octopus/shared/protocol';

export interface ListSessionsInput {
  workspaceId?: string;
  search?: string;
}

/**
 * Persists only Session control-plane metadata and preferences in SQLite.
 */
export class SessionsRepository {
  readonly #drafts = new SessionDraftsRepository();
  /**
   * @param database 控制面数据库
   */
  public constructor(
    private readonly database: OctopusDatabase,
    private readonly onChanged: (workspaceId: string, removed?: boolean) => void = () => undefined
  ) {}

  /**
   * 列出可选 Workspace 和搜索条件下的 Session，按创建时间排序以保持稳定顺序。
   */
  public list(input: ListSessionsInput = {}): SessionDto[] {
    const clauses = [
      ...(input.workspaceId === undefined ? [] : [eq(sessions.workspaceId, input.workspaceId)]),
      ...(input.search === undefined || input.search.trim() === ''
        ? []
        : [
            or(
              like(sessions.title, `%${input.search.trim()}%`),
              like(sessions.id, `%${input.search.trim()}%`)
            )!,
          ]),
    ];
    const query = this.database.db.select().from(sessions);
    const rows =
      clauses.length === 0
        ? query.orderBy(desc(sessions.pinnedAt), desc(sessions.createdAt)).all()
        : query
            .where(and(...clauses))
            .orderBy(desc(sessions.pinnedAt), desc(sessions.createdAt))
            .all();
    return rows.map(toSessionDto);
  }

  /**
   * 返回 Session DTO。
   */
  public get(id: string): SessionDto | undefined {
    const row = this.getRow(id);
    return row === undefined
      ? undefined
      : { ...toSessionDto(row), ...(this.#drafts.get(id) === undefined ? {} : { isDraft: true }) };
  }

  /**
   * 返回仅供 Server 内部使用、包含 Pi Session 路径的记录。
   */
  public getRow(id: string): SessionRow | undefined {
    return this.#drafts.get(id) ?? this.database.db.select().from(sessions).where(eq(sessions.id, id)).get();
  }

  /**
   * 新增或刷新一次已验证的 Pi Session 映射。
   */
  public upsert(input: NewSessionRow): SessionDto {
    this.database.db
      .insert(sessions)
      .values(input)
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          workspaceId: input.workspaceId,
          agentSessionId: input.agentSessionId,
          agentSessionPath: input.agentSessionPath,
          title: input.title,
          updatedAt: input.updatedAt,
          lastActiveAt: input.lastActiveAt,
          lastMessageAt: input.lastMessageAt,
        },
      })
      .run();
    this.#drafts.delete(input.id);
    this.onChanged(input.workspaceId);
    return this.get(input.id)!;
  }

  /**
   * 更新 Session 标题。
   */
  public rename(id: string, title: string): SessionDto {
    const updatedAt = new Date().toISOString();
    this.updateRow(id, { title, updatedAt });
    return this.get(id)!;
  }

  /**
   * Pins or unpins one Session while enforcing the per-Workspace catalog limit.
   *
   * @throws When pinning would exceed the Workspace pin limit.
   */
  public setPinned(id: string, pinned: boolean): SessionDto {
    const row = this.requireRow(id);
    if ((row.pinnedAt !== null) === pinned) {
      return this.get(id)!;
    }
    if (pinned) {
      const pinnedCount = this.database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.workspaceId, row.workspaceId), isNotNull(sessions.pinnedAt)))
        .all().length;
      if (pinnedCount >= MAX_PINNED_SESSIONS) {
        throw new Error('SESSION_PIN_LIMIT');
      }
    }
    const updatedAt = new Date().toISOString();
    this.updateRow(id, { pinnedAt: pinned ? updatedAt : null, updatedAt });
    return this.get(id)!;
  }

  /**
   * Resolves the Web catalog record mapped to one Pi Agent Session identity.
   */
  public getByAgentSessionId(agentSessionId: string): SessionRow | undefined {
    return (
      this.#drafts.list().find((row) => row.agentSessionId === agentSessionId) ??
      this.database.db.select().from(sessions).where(eq(sessions.agentSessionId, agentSessionId)).get()
    );
  }

  /**
   * 更新 Session 偏好与当前模型投影。
   */
  public updatePreferences(id: string, preferences: Partial<SessionPreferencesDto>): SessionDto {
    this.updateRow(id, {
      ...(preferences.thinkingLevel === undefined ? {} : { thinkingLevel: preferences.thinkingLevel }),
      ...(preferences.steeringMode === undefined ? {} : { steeringMode: preferences.steeringMode }),
      ...(preferences.followUpMode === undefined ? {} : { followUpMode: preferences.followUpMode }),
      ...(preferences.autoCompactionEnabled === undefined
        ? {}
        : { autoCompactionEnabled: preferences.autoCompactionEnabled }),
      ...(preferences.autoRetryEnabled === undefined
        ? {}
        : { autoRetryEnabled: preferences.autoRetryEnabled }),
      updatedAt: new Date().toISOString(),
    });
    return this.get(id)!;
  }

  /**
   * Updates the control-plane projection of the active Pi model.
   */
  public updateModel(id: string, provider: string, model: string): SessionDto {
    this.updateRow(id, { provider, model, updatedAt: new Date().toISOString() });
    return this.get(id)!;
  }

  /**
   * 更新最后活动时间。
   */
  public touch(id: string): void {
    const timestamp = new Date().toISOString();
    this.updateRow(id, { lastActiveAt: timestamp, updatedAt: timestamp });
  }

  /**
   * 更新最后聊天时间，不影响会话列表排序。
   */
  public recordLastMessageAt(id: string, timestamp: string): void {
    this.updateRow(id, { lastMessageAt: timestamp });
  }

  /**
   * 删除控制面记录，不删除 Pi Session 文件。
   */
  public delete(id: string): boolean {
    if (this.#drafts.delete(id)) {
      return true;
    }
    const row = this.getRow(id);
    const removed = this.database.db.delete(sessions).where(eq(sessions.id, id)).run().changes > 0;
    if (removed && row) {
      this.onChanged(row.workspaceId, true);
    }
    return removed;
  }

  /**
   * Creates an unpublished row while keeping catalog lists and SQLite free of empty home sessions.
   */
  public createDraft(input: NewSessionRow): SessionDto {
    this.#drafts.create(input);
    return this.get(input.id)!;
  }

  /**
   * Atomically persists the current draft preferences under the same Session identity; retries are harmless.
   */
  public publishDraft(id: string, title: string): SessionDto {
    const draft = this.#drafts.get(id);
    if (draft === undefined) {
      return toSessionDto(this.requireRow(id));
    }
    const timestamp = new Date().toISOString();
    return this.upsert({
      ...draft,
      title,
      pinnedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
    });
  }

  /**
   * Returns unpublished metadata exclusively for internal lifecycle maintenance.
   */
  public listDrafts(): SessionRow[] {
    return this.#drafts.list();
  }

  /**
   * Routes metadata changes to the owning storage without prematurely publishing a home draft.
   */
  private updateRow(id: string, values: Partial<SessionRow>): void {
    if (!this.#drafts.update(id, values)) {
      const row = this.getRow(id);
      this.database.db.update(sessions).set(values).where(eq(sessions.id, id)).run();
      if (row) {
        this.onChanged(row.workspaceId);
      }
    }
  }

  /**
   * 获取存在的记录，否则抛出稳定错误。
   */
  private requireRow(id: string): SessionRow {
    const row = this.getRow(id);
    if (row === undefined) {
      throw new Error(`Session was not found: ${id}`);
    }
    return row;
  }
}
