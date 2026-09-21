/**
 * @author Codex
 * @description Stores deduplicated completion notices and monotonic per-session read receipts.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { sessionNotifications as notices, sessions } from '../../db/schema.js';
import type { OctopusDatabase } from '../../db/client.js';
import type { NewSessionRow } from '../../db/schema.js';

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
