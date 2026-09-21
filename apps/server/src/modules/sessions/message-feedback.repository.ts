/**
 * @author Codex
 * @description 通过 Drizzle 持久化单条 Session 消息反馈（点赞/点踩）。
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { messageFeedback } from '../../db/schema.js';
import type { OctopusDatabase } from '../../db/client.js';
import type { MessageFeedbackDto } from '@octopus/shared/protocol';

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
