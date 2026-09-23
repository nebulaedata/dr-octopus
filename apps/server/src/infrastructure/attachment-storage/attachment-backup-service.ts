/**
 * @author root
 * @description Creates pinned SQLite and Blob-manifest local backups with checksum verification and bounded retention.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import type { LocalFileBlobStore } from './local-file-blob-store.js';
import type { OctopusDatabase } from '../../db/client.js';

interface BackupManifest {
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  blobs: Array<{ sha256: string; storageKey: string; byteSize: number }>;
}

interface PreparedBackup {
  id: string;
  directory: string;
  manifest: BackupManifest;
}

export interface VerifiedBackupSummary {
  backupId: string;
  createdAt: string;
  blobCount: number;
  totalBlobBytes: number;
}

/**
 * Coordinates backup pins with the database snapshot and later Blob copying.
 */
export class AttachmentBackupService {
  readonly #root: string;

  /**
   * @param database Process-owned SQLite database.
   * @param blobs Managed immutable Blob source.
   * @param root Dedicated local backup root.
   */
  public constructor(
    private readonly database: OctopusDatabase,
    private readonly blobs: LocalFileBlobStore,
    root: string
  ) {
    this.#root = resolve(root);
  }

  /**
   * Freezes the publication point, snapshots SQLite, and pins the exact Blob manifest.
   */
  public async prepare(): Promise<PreparedBackup> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const directory = join(this.#root, id);
    const databasePath = join(directory, 'octopus.db');
    const manifestPath = join(directory, 'manifest.json');
    await mkdir(directory, { recursive: true });
    const blobs = this.database.sqlite
      .prepare(`SELECT sha256,storage_key,byte_size FROM blobs WHERE state='published' ORDER BY sha256`)
      .all()
      .map((candidate) => {
        const row = candidate as { sha256: string; storage_key: string; byte_size: number };
        return { sha256: row.sha256, storageKey: row.storage_key, byteSize: row.byte_size };
      });
    const manifest: BackupManifest = { schemaVersion: 1, backupId: id, createdAt, blobs };
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `INSERT INTO backup_runs(id,status,database_snapshot_key,manifest_key,created_at) VALUES(?,'preparing',?,?,?)`
        )
        .run(id, `${id}/octopus.db`, `${id}/manifest.json`, createdAt);
      const pin = this.database.sqlite.prepare(
        'INSERT INTO backup_blob_pins(backup_id,blob_sha256) VALUES(?,?)'
      );
      for (const blob of blobs) {
        pin.run(id, blob.sha256);
      }
    })();
    try {
      const temporaryManifest = `${manifestPath}.tmp`;
      await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await syncFile(temporaryManifest);
      await rename(temporaryManifest, manifestPath);
      await this.database.sqlite.backup(databasePath);
      this.database.sqlite
        .prepare(`UPDATE backup_runs SET status='copying' WHERE id=? AND status='preparing'`)
        .run(id);
      return { id, directory, manifest };
    } catch {
      this.#finish(id, 'failed');
      await rm(directory, { recursive: true, force: true });
      throw new Error('ATTACHMENT_BACKUP_PREPARE_FAILED');
    }
  }

  /**
   * Copies and verifies pinned Blobs, marks the run verified, and releases pins.
   */
  public async copyAndVerify(prepared: PreparedBackup): Promise<void> {
    try {
      for (const blob of prepared.manifest.blobs) {
        const target = join(prepared.directory, 'blobs', ...blob.storageKey.split('/'));
        await mkdir(dirname(target), { recursive: true });
        const source = await this.blobs.openRead(blob.storageKey);
        await pipeline(source.stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
        await syncFile(target);
        const digest = await hashFile(target);
        if (digest.sha256 !== blob.sha256 || digest.byteSize !== blob.byteSize) {
          throw new Error('ATTACHMENT_BACKUP_CHECKSUM_MISMATCH');
        }
      }
      this.#finish(prepared.id, 'verified');
      await this.#pruneVerified(7);
    } catch {
      this.#finish(prepared.id, 'failed');
      throw new Error('ATTACHMENT_BACKUP_VERIFY_FAILED');
    }
  }

  /**
   * Reopens a completed backup and independently verifies its manifest, SQLite image, and Blobs.
   */
  public async verifyBackup(id: string): Promise<VerifiedBackupSummary> {
    assertBackupId(id);
    const directory = join(this.#root, id);
    let manifest: BackupManifest;
    try {
      manifest = parseManifest(await readFile(join(directory, 'manifest.json'), 'utf8'), id);
      const snapshot = new Database(join(directory, 'octopus.db'), { readonly: true, fileMustExist: true });
      try {
        const integrity = snapshot.pragma('integrity_check', { simple: true });
        const foreignKeyFailures = snapshot.pragma('foreign_key_check') as unknown[];
        if (integrity !== 'ok' || foreignKeyFailures.length !== 0) {
          throw new Error('ATTACHMENT_BACKUP_DATABASE_INVALID');
        }
      } finally {
        snapshot.close();
      }
      let totalBlobBytes = 0;
      for (const blob of manifest.blobs) {
        const digest = await hashFile(join(directory, 'blobs', ...blob.storageKey.split('/')));
        if (digest.sha256 !== blob.sha256 || digest.byteSize !== blob.byteSize) {
          throw new Error('ATTACHMENT_BACKUP_CHECKSUM_MISMATCH');
        }
        totalBlobBytes += blob.byteSize;
      }
      return {
        backupId: manifest.backupId,
        createdAt: manifest.createdAt,
        blobCount: manifest.blobs.length,
        totalBlobBytes,
      };
    } catch {
      throw new Error('ATTACHMENT_BACKUP_RESTORE_VALIDATION_FAILED');
    }
  }

  /**
   * Returns whether a verified backup was completed during the requested interval.
   */
  public hasRecentVerifiedBackup(maxAgeMs: number): boolean {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    return (
      this.database.sqlite
        .prepare(`SELECT 1 FROM backup_runs WHERE status='verified' AND completed_at>=? LIMIT 1`)
        .get(cutoff) !== undefined
    );
  }

  /**
   * Completes one run and releases all pins in the same SQLite transaction.
   */
  #finish(id: string, status: 'verified' | 'failed'): void {
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(`UPDATE backup_runs SET status=?,completed_at=? WHERE id=?`)
        .run(status, new Date().toISOString(), id);
      this.database.sqlite.prepare('DELETE FROM backup_blob_pins WHERE backup_id=?').run(id);
    })();
  }

  /**
   * Retains only the newest verified runs and removes their scoped directories.
   */
  async #pruneVerified(retain: number): Promise<void> {
    const stale = this.database.sqlite
      .prepare(
        `SELECT id FROM backup_runs WHERE status='verified' ORDER BY completed_at DESC LIMIT -1 OFFSET ?`
      )
      .all(retain) as Array<{ id: string }>;
    for (const run of stale) {
      await rm(join(this.#root, run.id), { recursive: true, force: true });
      this.database.sqlite.prepare('DELETE FROM backup_runs WHERE id=?').run(run.id);
    }
  }
}

/**
 * Rejects identifiers that could escape the dedicated backup root.
 */
function assertBackupId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
    throw new Error('ATTACHMENT_BACKUP_ID_INVALID');
  }
}

/**
 * Parses the immutable manifest with deny-by-default path and digest validation.
 */
function parseManifest(serialized: string, expectedId: string): BackupManifest {
  const value = JSON.parse(serialized) as Partial<BackupManifest>;
  if (
    value.schemaVersion !== 1 ||
    value.backupId !== expectedId ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.blobs)
  ) {
    throw new Error('ATTACHMENT_BACKUP_MANIFEST_INVALID');
  }
  for (const blob of value.blobs) {
    if (
      !/^[0-9a-f]{64}$/u.test(blob.sha256) ||
      blob.storageKey !==
        `blobs/sha256/${blob.sha256.slice(0, 2)}/${blob.sha256.slice(2, 4)}/${blob.sha256}` ||
      !Number.isSafeInteger(blob.byteSize) ||
      blob.byteSize < 0
    ) {
      throw new Error('ATTACHMENT_BACKUP_MANIFEST_INVALID');
    }
  }
  return value as BackupManifest;
}

/**
 * Flushes one generated backup file before it becomes externally visible.
 */
async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Streams one backup copy into a size and checksum verification result.
 */
async function hashFile(path: string): Promise<{ sha256: string; byteSize: number }> {
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    byteSize += bytes.byteLength;
  }
  return { sha256: hash.digest('hex'), byteSize };
}
