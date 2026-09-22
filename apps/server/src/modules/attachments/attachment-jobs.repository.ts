/**
 * @author root
 * @description Persists processor jobs with immediate-transaction claims, leases, heartbeats, bounded attempts, and stable completion states.
 */

import { randomUUID } from 'node:crypto';
import { ATTACHMENT_PROCESSOR } from './processor-identity.js';
import type { OctopusDatabase } from '../../db/client.js';

export interface AttachmentJob {
  id: string;
  attachmentId: string;
  jobType: 'process' | 'cleanup';
  input: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Owns the local durable queue without exposing SQLite to child processors.
 */
export class AttachmentJobsRepository {
  readonly #sqlite: OctopusDatabase['sqlite'];

  /**
   * @param database Process-owned SQLite control plane.
   */
  public constructor(database: OctopusDatabase) {
    this.#sqlite = database.sqlite;
  }

  /**
   * Enqueues a processor job exactly once for an attachment and source revision.
   */
  public enqueue(attachmentId: string, input: Record<string, unknown>): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#sqlite
      .prepare(
        `INSERT INTO attachment_jobs(id,attachment_id,job_type,processor_id,processor_version,input_json,status,attempts,max_attempts,available_at,created_at,updated_at) VALUES(?,?,'process',?,?,?,'pending',0,3,?,?,?)`
      )
      .run(
        id,
        attachmentId,
        ATTACHMENT_PROCESSOR.id,
        ATTACHMENT_PROCESSOR.version,
        JSON.stringify(input),
        now,
        now,
        now
      );
    return id;
  }

  /**
   * Enqueues idempotent physical cleanup after the logical deletion tombstone commits.
   */
  public enqueueCleanup(attachmentId: string): string {
    const existing = this.#sqlite
      .prepare(
        `SELECT id FROM attachment_jobs
         WHERE attachment_id=? AND job_type='cleanup' AND status IN ('pending','running','succeeded')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(attachmentId) as { id: string } | undefined;
    if (existing !== undefined) {
      return existing.id;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#sqlite
      .prepare(
        `INSERT INTO attachment_jobs(
           id,attachment_id,job_type,input_json,status,attempts,max_attempts,
           available_at,created_at,updated_at
         ) VALUES(?,?,'cleanup','{}','pending',0,4,?,?,?)`
      )
      .run(id, attachmentId, now, now, now);
    return id;
  }

  /**
   * Requeues the completed placeholder job used while a legal hold deferred physical cleanup.
   *
   * @param attachmentId Attachment whose held delete operation returned to cleanup-pending.
   * @returns Durable cleanup job identity.
   */
  public resumeCleanup(attachmentId: string): string {
    const existing = this.#sqlite
      .prepare(
        `SELECT id,status FROM attachment_jobs
         WHERE attachment_id=? AND job_type='cleanup'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(attachmentId) as { id: string; status: string } | undefined;
    if (existing === undefined) {
      return this.enqueueCleanup(attachmentId);
    }
    if (existing.status === 'pending' || existing.status === 'running') {
      return existing.id;
    }
    const now = new Date().toISOString();
    this.#sqlite
      .prepare(
        `UPDATE attachment_jobs
         SET status='pending',attempts=0,available_at=?,lease_owner=NULL,lease_expires_at=NULL,
             last_error_code=NULL,result_json=NULL,updated_at=?
         WHERE id=?`
      )
      .run(now, now, existing.id);
    return existing.id;
  }

  /**
   * Claims one pending or expired-lease job using a 30-second fenced lease.
   */
  public claim(owner: string): AttachmentJob | undefined {
    return this.#sqlite
      .transaction(() => {
        const now = new Date();
        const nowIso = now.toISOString();
        const row = this.#sqlite
          .prepare(
            `SELECT id,attachment_id,job_type,input_json,attempts,max_attempts FROM attachment_jobs WHERE attempts < max_attempts AND ((status='pending' AND available_at<=?) OR (status='running' AND lease_expires_at<=?)) ORDER BY available_at,created_at LIMIT 1`
          )
          .get(nowIso, nowIso) as
          | {
              id: string;
              attachment_id: string;
              job_type: 'process' | 'cleanup';
              input_json: string;
              attempts: number;
              max_attempts: number;
            }
          | undefined;
        if (row === undefined) {
          return undefined;
        }
        const lease = new Date(now.getTime() + 30_000).toISOString();
        const changed = this.#sqlite
          .prepare(
            `UPDATE attachment_jobs SET status='running',attempts=attempts+1,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND attempts=?`
          )
          .run(owner, lease, nowIso, row.id, row.attempts);
        if (changed.changes !== 1) {
          return undefined;
        }
        return {
          id: row.id,
          attachmentId: row.attachment_id,
          jobType: row.job_type,
          input: JSON.parse(row.input_json) as Record<string, unknown>,
          attempts: row.attempts + 1,
          maxAttempts: row.max_attempts,
        };
      })
      .immediate();
  }

  /**
   * Returns the next known retry or abandoned-lease deadline; active local jobs wake the pump on completion.
   */
  public nextWake(owner: string): number | undefined {
    const row = this.#sqlite
      .prepare(
        `SELECT MIN(CASE WHEN status='pending' THEN available_at ELSE lease_expires_at END) AS deadline
      FROM attachment_jobs WHERE attempts < max_attempts AND (status='pending' OR (status='running' AND lease_owner<>?))`
      )
      .get(owner) as { deadline: string | null };
    return row.deadline === null ? undefined : Date.parse(row.deadline);
  }

  /**
   * Extends the lease held by an active parent-side job runner.
   */
  public heartbeat(id: string, owner: string): void {
    const now = new Date();
    this.#sqlite
      .prepare(
        `UPDATE attachment_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND status='running' AND lease_owner=?`
      )
      .run(new Date(now.getTime() + 30_000).toISOString(), now.toISOString(), id, owner);
  }
  /**
   * Marks a verified job result as durable success.
   */
  public succeed(id: string, owner: string, result: unknown): void {
    this.#sqlite
      .prepare(
        `UPDATE attachment_jobs SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,result_json=?,updated_at=? WHERE id=? AND status='running' AND lease_owner=?`
      )
      .run(JSON.stringify(result), new Date().toISOString(), id, owner);
  }
  /**
   * Applies retry backoff or terminal failure according to stable retryability and attempts.
   */
  public fail(job: AttachmentJob, owner: string, code: string, retryable: boolean): void {
    const terminal = !retryable || job.attempts >= job.maxAttempts;
    const delays = [60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000] as const;
    const delay = delays[Math.min(job.attempts - 1, delays.length - 1)] ?? delays[0];
    const now = new Date();
    this.#sqlite
      .prepare(
        `UPDATE attachment_jobs
         SET status=?,available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=?
         WHERE id=? AND status='running' AND lease_owner=?`
      )
      .run(
        terminal ? 'failed' : 'pending',
        new Date(now.getTime() + delay).toISOString(),
        code,
        now.toISOString(),
        job.id,
        owner
      );
  }
  /**
   * Cancels queued or leased processor work when its attachment becomes deleted.
   */
  public cancelForAttachment(attachmentId: string): void {
    this.#sqlite
      .prepare(
        `UPDATE attachment_jobs
         SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
         WHERE attachment_id=? AND job_type='process' AND status IN ('pending','running')`
      )
      .run(new Date().toISOString(), attachmentId);
  }
}
