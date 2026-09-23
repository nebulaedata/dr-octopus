/**
 * @author Codex
 * @description Persists first-message ownership, request identity and conservative crash recovery.
 */

import { eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { conversationStarts } from '../../db/schema.js';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import type { ConversationStartInput, ConversationStartStatus } from '@octopus/shared/protocol';
import type { OctopusDatabase } from '../../db/client.js';

export class ConversationStartRepository {
  /**
   * Shares the Host database so acceptance and publication can commit atomically.
   */
  constructor(private readonly database: OctopusDatabase) {}

  /**
   * Reads one durable operation; callers must validate its Workspace.
   */
  get(id: string) {
    return this.database.db
      .select()
      .from(conversationStarts)
      .where(eq(conversationStarts.submissionId, id))
      .get();
  }

  /**
   * Finds the durable first-message receipt displayed in a published conversation.
   */
  forSession(workspaceId: string, id: string) {
    const row = this.database.db
      .select()
      .from(conversationStarts)
      .where(eq(conversationStarts.sessionId, id))
      .get();
    return row?.workspaceId === workspaceId ? row : undefined;
  }

  /**
   * Claims one draft exactly once; retained failed operations prevent ambiguous replay.
   */
  claim(workspaceId: string, request: ConversationStartInput) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ workspaceId, request })).digest('hex');
    return this.database.db.transaction(() => {
      const existing = this.get(request.submissionId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new ApplicationError(
            'CONVERSATION_START_CONFLICT',
            'Submission identity conflicts with its saved request.',
            { statusCode: 409 }
          );
        }
        return existing;
      }
      const owner = this.database.db
        .select()
        .from(conversationStarts)
        .where(eq(conversationStarts.activeDraftId, request.draftId))
        .get();
      if (owner) {
        const canonical = createHash('sha256')
          .update(JSON.stringify({ workspaceId, request: { ...request, submissionId: owner.submissionId } }))
          .digest('hex');
        if (canonical === owner.fingerprint) {
          return owner;
        }
        throw new ApplicationError(
          'CONVERSATION_START_CONFLICT',
          'This draft already has an accepted or pending submission.',
          { statusCode: 409 }
        );
      }
      this.database.db
        .insert(conversationStarts)
        .values({
          submissionId: request.submissionId,
          workspaceId,
          draftId: request.draftId,
          activeDraftId: request.draftId,
          sessionId: randomUUID(),
          fingerprint,
          request,
          status: 'preparing',
          updatedAt: new Date().toISOString(),
        })
        .run();
      return this.get(request.submissionId)!;
    });
  }

  /**
   * Releases a draft only for a confirmed failure before acceptance or cancellation.
   */
  set(id: string, status: ConversationStartStatus, error?: string) {
    this.database.db
      .update(conversationStarts)
      .set({
        status,
        error: error ?? null,
        updatedAt: new Date().toISOString(),
        ...(status === 'failed' || status === 'cancelled' ? { activeDraftId: null } : {}),
      })
      .where(eq(conversationStarts.submissionId, id))
      .run();
  }

  /**
   * Returns requests durably accepted before the Host crossed the RPC dispatch boundary.
   */
  accepted() {
    return this.database.db
      .select()
      .from(conversationStarts)
      .where(eq(conversationStarts.status, 'accepted'))
      .all();
  }

  /**
   * Never replays possibly delivered RPC messages after a Host crash.
   */
  recover() {
    this.database.db
      .update(conversationStarts)
      .set({
        status: 'failed',
        activeDraftId: null,
        error: 'Preparation was interrupted. Retry your saved draft.',
      })
      .where(eq(conversationStarts.status, 'preparing'))
      .run();
    this.database.db
      .update(conversationStarts)
      .set({
        status: 'unknown',
        error: 'Delivery could not be confirmed. Inspect the conversation before sending again.',
      })
      .where(inArray(conversationStarts.status, ['dispatching']))
      .run();
  }

  /**
   * Commits Session publication and acceptance in the same synchronous SQLite transaction.
   */
  accept(submissionId: string, publishSession: () => void): void {
    this.database.db.transaction(() => {
      publishSession();
      this.set(submissionId, 'accepted');
    });
  }
}
