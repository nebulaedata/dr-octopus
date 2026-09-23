/**
 * @author Codex
 * @description Owns knowledge upload metadata queries without performing publication or transport work.
 */
import { eq, lt } from 'drizzle-orm';
import { knowledgeUploads } from '../../db/schema.js';
import type { OctopusDatabase } from '../../db/client.js';
export class KnowledgeUploadsRepository {
  /**
   * Borrows the application-owned connection.
   */
  constructor(private readonly database: OctopusDatabase) {}
  /**
   * findByRequestKey through the original knowledge upload query.
   */
  findByRequestKey(requestKey: string) {
    return this.database.db
      .select()
      .from(knowledgeUploads)
      .where(eq(knowledgeUploads.requestKey, requestKey))
      .get();
  }
  /**
   * listPending through the original knowledge upload query.
   */
  listPending() {
    return this.database.db.select().from(knowledgeUploads).all();
  }
  /**
   * insert through the original knowledge upload query.
   */
  insert(input: typeof knowledgeUploads.$inferInsert) {
    return this.database.db
      .insert(knowledgeUploads)
      .values(input)
      .onConflictDoNothing({ target: knowledgeUploads.requestKey })
      .run();
  }
  /**
   * get through the original knowledge upload query.
   */
  get(id: string) {
    return this.database.db.select().from(knowledgeUploads).where(eq(knowledgeUploads.id, id)).get();
  }
  /**
   * updateOffset through the original knowledge upload query.
   */
  updateOffset(id: string, next: number) {
    return this.database.db
      .update(knowledgeUploads)
      .set({ offset: next })
      .where(eq(knowledgeUploads.id, id))
      .run();
  }
  /**
   * markPublished through the original knowledge upload query.
   */
  markPublished(id: string, sha256: string) {
    return this.database.db
      .update(knowledgeUploads)
      .set({ blobSha256: sha256 })
      .where(eq(knowledgeUploads.id, id))
      .run();
  }
  /**
   * remove through the original knowledge upload query.
   */
  remove(id: string) {
    return this.database.db.delete(knowledgeUploads).where(eq(knowledgeUploads.id, id)).run();
  }
  /**
   * listExpired through the original knowledge upload query.
   */
  listExpired() {
    return this.database.db
      .select()
      .from(knowledgeUploads)
      .where(lt(knowledgeUploads.expiresAt, new Date().toISOString()))
      .limit(100)
      .all();
  }
}
