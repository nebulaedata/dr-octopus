/**
 * @author Codex
 * @description 通过 Drizzle 持久化 Dr.Octopus Session 控制面映射、元数据与偏好
 */

import { MAX_PINNED_SESSIONS } from '@octopus/shared/protocol';
import { and, desc, eq, isNotNull, like, or } from 'drizzle-orm';
import { sessions } from '../../db/schema.js';
import { toSessionDto } from './sessions.utils.js';
import { randomUUID } from 'node:crypto';
import { messageFeedback } from '../../db/schema.js';
import { inArray, sql } from 'drizzle-orm';
import { sessionNotifications as notices } from '../../db/schema.js';
import type { SessionDto, SessionPreferencesDto } from '@octopus/shared/protocol';
import type { OctopusDatabase } from '../../db/client.js';
import type { NewSessionRow, SessionRow } from '../../db/schema.js';
import type { MessageFeedbackDto } from '@octopus/shared/protocol';

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
    if (row === undefined) {
      return undefined;
    }
    return { ...toSessionDto(row), ...(this.#drafts.get(id) === undefined ? {} : { isDraft: true }) };
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

/**
 * 控制面消息反馈仓储。
 */
export class MessageFeedbackRepository {
  /**
   * @param database 控制面数据库
   */
  public constructor(private readonly database: OctopusDatabase) {}

  /**
   * 列出某 Session 下的全部消息反馈。
   *
   * @param sessionId - Session 标识。
   * @returns 反馈 DTO 数组，按创建时间升序排列。
   */
  public listBySession(sessionId: string): MessageFeedbackDto[] {
    const rows = this.database.db
      .select()
      .from(messageFeedback)
      .where(eq(messageFeedback.sessionId, sessionId))
      .orderBy(messageFeedback.createdAt)
      .all();
    return rows.map((row) => ({
      entryId: row.entryId,
      rating: row.rating as 'up' | 'down',
      createdAt: row.createdAt,
    }));
  }

  /**
   * 新增或更新一条消息反馈；同一 Session + entryId 仅保留最新评分。
   *
   * @param sessionId - Session 标识。
   * @param entryId - Pi history entry 标识。
   * @param rating - 'up' 或 'down'。
   * @returns 保存后的反馈 DTO。
   */
  public upsert(sessionId: string, entryId: string, rating: 'up' | 'down'): MessageFeedbackDto {
    const timestamp = new Date().toISOString();
    this.database.db
      .insert(messageFeedback)
      .values({
        id: randomUUID(),
        sessionId,
        entryId,
        rating,
        createdAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [messageFeedback.sessionId, messageFeedback.entryId],
        set: { rating, createdAt: timestamp },
      })
      .run();
    const row = this.database.db
      .select()
      .from(messageFeedback)
      .where(and(eq(messageFeedback.sessionId, sessionId), eq(messageFeedback.entryId, entryId)))
      .get();
    if (row === undefined) {
      throw new Error('Failed to persist message feedback.');
    }
    return {
      entryId: row.entryId,
      rating: row.rating as 'up' | 'down',
      createdAt: row.createdAt,
    };
  }
}

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

/**
 * Commit notice publication and both source/result unread pointers in one transaction.
 */
export class SessionNotificationsRepository {
  /**
   * Reuse the Host database; scheduler execution state remains Agent-owned.
   */
  constructor(
    private readonly database: OctopusDatabase,
    private readonly onChanged: (workspaceId: string) => void = () => undefined
  ) {}

  /**
   * Atomically register the real dormant Session and its delivery receipt.
   */
  registerResult(session: NewSessionRow, notice: typeof notices.$inferInsert): void {
    this.database.sqlite
      .transaction(() => {
        if (this.has(notice.eventKey)) {
          return;
        }
        this.database.db.insert(sessions).values(session).run();
        this.insertNotice(notice);
      })
      .immediate();
    this.onChanged(session.workspaceId);
  }

  /**
   * Keep a receipt after manual Session removal so synchronization cannot resurrect it.
   */
  findRun(workspaceId: string, runId: string) {
    return this.database.db
      .select()
      .from(notices)
      .where(and(eq(notices.workspaceId, workspaceId), eq(notices.runId, runId)))
      .get();
  }

  /**
   * Scan bounded delivery references for authoritative task deletion outside this Host.
   */
  runReceipts(offset: number) {
    return this.database.db
      .select({ workspaceId: notices.workspaceId, taskId: notices.taskId, runId: notices.runId })
      .from(notices)
      .where(sql`${notices.runId} is not null`)
      .orderBy(notices.id)
      .limit(50)
      .offset(offset)
      .all();
  }

  /**
   * Drain one purged task's references in bounded batches.
   */
  taskReceipts(workspaceId: string, taskId: string) {
    return this.database.db
      .select({ runId: notices.runId })
      .from(notices)
      .where(and(eq(notices.workspaceId, workspaceId), eq(notices.taskId, taskId)))
      .limit(50)
      .all();
  }

  /**
   * Look up an event receipt, including notices whose session was manually removed.
   */
  has(eventKey: string): boolean {
    return !!this.database.db
      .select({ id: notices.id })
      .from(notices)
      .where(eq(notices.eventKey, eventKey))
      .get();
  }

  /**
   * Publish once; retries never make an already-read result unread again.
   */
  publish(input: typeof notices.$inferInsert): void {
    this.database.sqlite.transaction(() => this.insertNotice(input)).immediate();
    this.onChanged(input.workspaceId);
  }

  /**
   * Write inside the caller-owned transaction; publication happens only after its outer commit.
   */
  private insertNotice(input: typeof notices.$inferInsert): void {
    const row = this.database.db.insert(notices).values(input).onConflictDoNothing().returning().get();
    if (!row) {
      return;
    }
    this.database.db
      .update(sessions)
      .set({ notificationVersion: row.id })
      .where(inArray(sessions.id, [row.sessionId, ...(row.originSessionId ? [row.originSessionId] : [])]))
      .run();
  }

  /**
   * Acknowledge only the observed version; concurrent later notices remain unread.
   */
  markRead(workspaceId: string, sessionId: string, version: number): void {
    this.database.db
      .update(sessions)
      .set({
        readVersion: sql`max(${sessions.readVersion}, min(${sessions.notificationVersion}, ${version}))`,
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
      .run();
    this.onChanged(workspaceId);
  }

  /**
   * Acknowledge all current Session notice versions atomically; later publications remain unread.
   */
  markAllRead(): void {
    const changed = this.database.db
      .update(sessions)
      .set({ readVersion: sessions.notificationVersion })
      .where(sql`${sessions.readVersion} < ${sessions.notificationVersion}`)
      .returning({ workspaceId: sessions.workspaceId })
      .all();
    for (const workspaceId of new Set(changed.map((row) => row.workspaceId))) {
      this.onChanged(workspaceId);
    }
  }

  /**
   * Return globally paginated notifications or a source session's result links.
   */
  list(offset = 0, sessionId?: string) {
    return this.database.db
      .select({
        id: notices.id,
        workspaceId: notices.workspaceId,
        sessionId: notices.sessionId,
        originSessionId: notices.originSessionId,
        taskId: notices.taskId,
        runId: notices.runId,
        title: notices.title,
        summary: notices.summary,
        status: notices.status,
        createdAt: notices.createdAt,
        unread: sql<boolean>`${sessions.readVersion} < ${notices.id}`.mapWith(Boolean),
      })
      .from(notices)
      .innerJoin(sessions, eq(sessions.id, notices.sessionId))
      .where(
        sessionId ? or(eq(notices.sessionId, sessionId), eq(notices.originSessionId, sessionId)) : undefined
      )
      .orderBy(desc(notices.createdAt), desc(notices.id))
      .limit(21)
      .offset(offset)
      .all();
  }

  /**
   * Count unseen target-session notices independently of the current workspace.
   */
  unreadCount(): number {
    return (
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(notices)
        .innerJoin(sessions, eq(sessions.id, notices.sessionId))
        .where(sql`${sessions.readVersion} < ${notices.id}`)
        .get()?.count ?? 0
    );
  }

  /**
   * Remove catalog references after an authoritative purge and recompute affected unread pointers.
   */
  removeRun(workspaceId: string, runId: string): void {
    this.database.sqlite
      .transaction(() => {
        const rows = this.database.db
          .select()
          .from(notices)
          .where(and(eq(notices.workspaceId, workspaceId), eq(notices.runId, runId)))
          .all();
        for (const row of rows) {
          this.database.db
            .delete(sessions)
            .where(and(eq(sessions.id, row.sessionId), sql`${sessions.execution} is not null`))
            .run();
          this.database.db.delete(notices).where(eq(notices.id, row.id)).run();
          if (row.originSessionId) {
            this.database.db
              .update(sessions)
              .set({
                notificationVersion: sql`coalesce((select max(id) from session_notifications where session_id = ${row.originSessionId} or origin_session_id = ${row.originSessionId}), 0)`,
              })
              .where(eq(sessions.id, row.originSessionId))
              .run();
          }
        }
      })
      .immediate();
    this.onChanged(workspaceId);
  }
}
