/**
 * @author Codex
 * @description Bounded idle-time reclamation with seven-day evidence retention and recoverable cross-store ordering.
 */
import { readdir, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, isNull, lt } from 'drizzle-orm';
import {
  blobs,
  citations,
  collections,
  documents,
  entries,
  generations,
  importItems,
  jobs,
  remoteCitations,
  versions,
} from '../db/schema.js';
import type { KnowledgeDatabase } from '../db/database.js';
import type { LanceKnowledgeIndex } from './lance-index.js';

/**
 * Run exclusively against other application calls and only while the single indexing worker is idle.
 * Native deletion precedes metadata deletion so interrupted cleanup can be retried idempotently.
 */
export async function maintainKnowledge(
  database: KnowledgeDatabase,
  index: LanceKnowledgeIndex,
  directory: string,
  now = Date.now()
): Promise<void> {
  const db = database.db;
  const timestamp = new Date(now).toISOString();
  const cutoff = new Date(now - 7 * 86_400_000).toISOString();
  db.delete(citations).where(lt(citations.expiresAt, timestamp)).run();
  db.delete(remoteCitations).where(lt(remoteCitations.expiresAt, timestamp)).run();
  const parents = new Map(
    db
      .select()
      .from(collections)
      .all()
      .map((row) => [row.id, row])
  );
  const docs = new Map(
    db
      .select()
      .from(documents)
      .all()
      .map((row) => [row.id, row])
  );
  const retainedJobs = db.select().from(jobs).all();
  const activeJobs = retainedJobs.filter((row) =>
    ['queued', 'running', 'waiting_dependency'].includes(row.state)
  );
  for (const generation of db.select().from(generations).all()) {
    const parent = parents.get(generation.collectionId);
    if (parent && !parent.deletedAt && parent.activeGenerationId === generation.id) {
      continue;
    }
    if (activeJobs.some((row) => row.targetGenerationId === generation.id)) {
      continue;
    }
    if (!generation.retiredAt) {
      db.update(generations).set({ retiredAt: timestamp }).where(eq(generations.id, generation.id)).run();
    }
  }
  for (const version of db.select().from(versions).where(isNull(versions.retiredAt)).all()) {
    const doc = docs.get(version.documentId);
    if (
      doc &&
      !doc.deletedAt &&
      !parents.get(doc.collectionId)?.deletedAt &&
      (doc.activeVersionId === version.id || doc.desiredVersionId === version.id)
    ) {
      continue;
    }
    db.update(versions).set({ retiredAt: timestamp }).where(eq(versions.id, version.id)).run();
  }
  const liveCitations = db.select().from(citations).all();
  let removedGenerations = 0;
  for (const generation of db.select().from(generations).where(lt(generations.retiredAt, cutoff)).all()) {
    const parent = parents.get(generation.collectionId);
    if (
      (!parent?.deletedAt && parent?.activeGenerationId === generation.id) ||
      activeJobs.some((row) => row.targetGenerationId === generation.id) ||
      liveCitations.some((row) => row.generationId === generation.id)
    ) {
      continue;
    }
    await index.remove(generation.id);
    removedGenerations++;
    database.sqlite.transaction(() => {
      for (const job of retainedJobs.filter((row) => row.targetGenerationId === generation.id)) {
        db.update(jobs).set({ targetGenerationId: null }).where(eq(jobs.id, job.id)).run();
        if (job.kind === 'reindex') {
          db.update(importItems).set({ status: 'queued' }).where(eq(importItems.jobId, job.id)).run();
        }
      }
      db.update(collections)
        .set({ activeGenerationId: null })
        .where(and(eq(collections.activeGenerationId, generation.id)))
        .run();
      db.delete(entries).where(eq(entries.generationId, generation.id)).run();
      db.delete(generations).where(eq(generations.id, generation.id)).run();
    })();
    if (removedGenerations >= 4) {
      break;
    }
  }
  const retainedVersions = db
    .select()
    .from(versions)
    .all()
    .filter((row) => row.retiredAt !== null && row.retiredAt >= cutoff)
    .map((row) => row.id);
  const remainingGenerations = db.select().from(generations).all();
  // Rotate the starting point so a bounded tick eventually visits every generation.
  for (const generation of remainingGenerations
    .slice(Math.floor(now / 60_000) % Math.max(1, remainingGenerations.length))
    .slice(0, 4)) {
    const visible = db
      .select()
      .from(entries)
      .where(eq(entries.generationId, generation.id))
      .all()
      .filter((entry) => {
        const doc = docs.get(entry.documentId);
        return doc && !doc.deletedAt && !parents.get(doc.collectionId)?.deletedAt;
      });
    await index.prune(
      generation.id,
      visible.map((row) => row.indexRevision),
      retainedVersions,
      liveCitations.filter((row) => row.generationId === generation.id).map((row) => row.chunkId)
    );
  }
  for (const doc of docs.values()) {
    const deletedAt = doc.deletedAt ?? parents.get(doc.collectionId)?.deletedAt;
    if (deletedAt && deletedAt < cutoff) {
      db.delete(entries).where(eq(entries.documentId, doc.id)).run();
    }
  }
  const jobCutoff = new Date(now - 30 * 86_400_000).toISOString();
  for (const job of retainedJobs
    .filter((row) => row.finishedAt && row.finishedAt < jobCutoff)
    .slice(0, 100)) {
    database.sqlite.transaction(() => {
      db.delete(importItems).where(eq(importItems.jobId, job.id)).run();
      db.delete(jobs).where(eq(jobs.id, job.id)).run();
    })();
  }
  const pinnedVersions = new Set([
    ...db
      .select()
      .from(entries)
      .all()
      .map((row) => row.documentVersionId),
    ...db
      .select()
      .from(importItems)
      .all()
      .map((row) => row.documentVersionId),
    ...liveCitations.map((row) => row.documentVersionId),
  ]);
  for (const version of db.select().from(versions).where(lt(versions.retiredAt, cutoff)).limit(100).all()) {
    const doc = docs.get(version.documentId);
    if (
      pinnedVersions.has(version.id) ||
      (doc && !doc.deletedAt && (doc.activeVersionId === version.id || doc.desiredVersionId === version.id))
    ) {
      continue;
    }
    db.delete(versions).where(eq(versions.id, version.id)).run();
  }
  const sourceHashes = new Set([
    ...db
      .select()
      .from(versions)
      .all()
      .map((row) => row.sourceSha256),
    ...db
      .select()
      .from(jobs)
      .all()
      .map((row) => row.source?.blobSha256),
  ]);
  const blobRoot = join(directory, 'blobs');
  const files = await readdir(blobRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  let removed = 0;
  for (const name of files) {
    if (removed >= 100) {
      break;
    }
    if (!/^[a-f0-9]{64}(?:\.[a-f0-9-]{36})?$/u.test(name) || sourceHashes.has(name)) {
      continue;
    }
    const path = join(blobRoot, name);
    const info = await lstat(path);
    if (info.isFile() && info.mtimeMs < now - 86_400_000) {
      await rm(path);
      db.delete(blobs).where(eq(blobs.sha256, name)).run();
      removed += 1;
    }
  }
}
