/**
 * @author Codex
 * @description Verified source fingerprints and collection-scoped duplicate checks inside import transactions.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { blobs, documents, importItems, jobs, versions } from '../db/schema.js';
import { KnowledgeError } from '../definitions/error.js';
import type { KnowledgeDatabase } from '../db/database.js';
import type { KnowledgeBlobStore } from './blob-store.js';

/**
 * Persist only hashes computed from verified daemon-owned bytes, never client-provided MD5 values.
 */
export async function rememberKnowledgeSource(
  database: KnowledgeDatabase,
  store: KnowledgeBlobStore,
  sha256: string
): Promise<void> {
  const fingerprint = await store.fingerprint(sha256);
  database.db
    .insert(blobs)
    .values({ ...fingerprint, createdAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: blobs.sha256, set: { md5: fingerprint.md5, size: fingerprint.size } })
    .run();
}

/**
 * Reject current document content and, at admission, unfinished or still-live imports in this collection.
 * Call synchronously inside the same transaction that creates the job or document.
 * Legacy sources without MD5 remain protected by their existing SHA-256 content identity.
 */
export function assertKnowledgeSourceAvailable(
  database: KnowledgeDatabase,
  collectionId: string,
  sha256: string,
  checkJobs = false
): void {
  const db = database.db;
  const fingerprint = db.select().from(blobs).where(eq(blobs.sha256, sha256)).get();
  const hashes = fingerprint?.md5
    ? db
        .select()
        .from(blobs)
        .where(eq(blobs.md5, fingerprint.md5))
        .all()
        .map((blob) => blob.sha256)
    : [sha256];
  const document = db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(
      versions,
      or(eq(versions.id, documents.activeVersionId), eq(versions.id, documents.desiredVersionId))
    )
    .where(
      and(
        eq(documents.collectionId, collectionId),
        isNull(documents.deletedAt),
        inArray(versions.sourceSha256, hashes)
      )
    )
    .get();
  if (document) {
    throw duplicate();
  }
  if (!checkJobs) {
    return;
  }
  const candidates = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.collectionId, collectionId),
        eq(jobs.kind, 'import'),
        inArray(sql<string>`json_extract(${jobs.source}, '$.blobSha256')`, hashes)
      )
    )
    .all();
  for (const job of candidates) {
    const leaves = db
      .select({ documentId: importItems.documentId, liveId: documents.id })
      .from(importItems)
      .leftJoin(
        documents,
        and(
          eq(documents.id, importItems.documentId),
          isNull(documents.deletedAt),
          or(
            eq(documents.activeVersionId, importItems.documentVersionId),
            eq(documents.desiredVersionId, importItems.documentVersionId)
          )
        )
      )
      .where(eq(importItems.jobId, job.id))
      .all();
    const pending = !job.cancelRequested && ['queued', 'running', 'waiting_dependency'].includes(job.state);
    if (leaves.some((leaf) => leaf.liveId) || (pending && !leaves.some((leaf) => leaf.documentId))) {
      throw duplicate();
    }
  }
}

/**
 * Keep direct admission errors actionable in Web, CLI and tool clients.
 */
function duplicate(): KnowledgeError {
  return new KnowledgeError('DOCUMENT_DUPLICATE_CONFLICT', '该文档已存在或正在导入，请勿重复上传');
}
