/**
 * @author Codex
 * @description Serializes native file publication and preserves durable evidence, idempotent outcomes and restart gates.
 */
import { createHash, randomUUID } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { BasicToolError } from './basic-inputs';
import type { NativeFileCommit } from './native-file-commit';
import { decodeText, readTextSnapshot } from './text-file';

const resultSchema = z.strictObject({
  status: z.enum(['applied', 'no_change', 'not_applied', 'conflict_after_commit', 'uncertain']),
  version: z.string().length(64).optional(),
  recoveryId: z.uuid(),
  nativeCode: z.number().int().nonnegative().optional(),
});
export type PublicationResult = z.infer<typeof resultSchema>;
const recordSchema = z.strictObject({
  id: z.uuid(),
  ownerId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
  key: z.string().min(1).max(128),
  fingerprint: z.string().length(64),
  target: z.string().min(1).max(30000),
  targetIdentity: z.string().max(128),
  parentIdentity: z.string().max(128),
  tempIdentity: z.string().max(128),
  recoveryIdentity: z.string().max(128),
  expectedVersion: z.string().max(256),
  expectedHash: z.string().length(64).nullable(),
  proposedHash: z.string().length(64),
  retainedBytes: z
    .number()
    .int()
    .min(0)
    .max(32 * 1024 * 1024),
  phase: z.enum(['prepared', 'commit_started', 'terminal']),
  result: resultSchema.optional(),
});
type Record = z.infer<typeof recordSchema>;
type PublicationInput = {
  target: string;
  expectedVersion: string;
  content: Buffer;
  ownerId: string;
  taskId: string;
  idempotencyKey: string;
};

// One owner per journal in this Runtime; simultaneous instances must not build independent mutation queues.
const ownedJournals = new Set<string>();

/**
 * Hashes raw bytes only; identity is tracked separately for post-commit and recovery verification.
 */
function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Builds an unambiguous owner/task/key tuple without granting any authority.
 */
function operationKey(owner: string, task: string, key: string): string {
  return JSON.stringify([owner, task, key]);
}

export class FilePublication {
  private tail: Promise<void> = Promise.resolve();
  private readonly operations = new Map<
    string,
    { fingerprint: string; pending: Promise<PublicationResult> }
  >();
  private readonly blocked = new Set<string>();
  private retainedBytes = 0;
  private pendingBytes = 0;
  private accepting = true;
  private ownershipReleased = false;

  /**
   * Owns one Runtime's publication queue and private journal; construction is through open().
   */
  private constructor(
    private readonly native: NativeFileCommit,
    private readonly journal: string
  ) {}

  /**
   * Opens a private journal beneath the Host-owned project and recovers without replaying mutations.
   * The Host must create the parent first. Malformed or oversized journals fail closed.
   */
  static async open(native: NativeFileCommit, projectRoot: string): Promise<FilePublication> {
    const journal = join(projectRoot, 'file-operations');
    const ownershipKey = journal.toLowerCase();
    if (ownedJournals.has(ownershipKey)) {
      throw new BasicToolError('RECOVERY_IN_USE', 'This Runtime already owns the mutation journal.');
    }
    ownedJournals.add(ownershipKey);
    try {
      const created = await native.createRecovery(journal);
      if (!created.ok && created.nativeCode !== 183) {
        throw new BasicToolError('RECOVERY_UNAVAILABLE', 'Cannot create the private mutation journal.');
      }
      const info = await native.inspect(journal);
      if (!info.ok || !info.directory || !info.privateAcl) {
        throw new BasicToolError(
          'RECOVERY_UNAVAILABLE',
          'The mutation journal is not a private NTFS directory.'
        );
      }
      const publisher = new FilePublication(native, journal);
      await publisher.recover();
      return publisher;
    } catch (error) {
      ownedJournals.delete(ownershipKey);
      throw error;
    }
  }

  /**
   * Publishes a path already authorized and canonicalized by the task service, with an explicit observed version.
   * This infrastructure API is not a tool handler: it does not grant device capabilities, task identity or permissions.
   * Mutations are serialized globally in this initial implementation, including different target files.
   */
  publish(input: PublicationInput): Promise<PublicationResult> {
    if (!this.accepting) {
      return Promise.reject(new BasicToolError('PUBLICATION_STOPPED', 'File publication is shutting down.'));
    }
    if (
      ![input.ownerId, input.taskId, input.idempotencyKey].every(
        (value) => value.length > 0 && value.length <= 128
      ) ||
      input.content.length > 16 * 1024 * 1024 ||
      !/^(absent|[a-f0-9]{64})$/.test(input.expectedVersion)
    ) {
      return Promise.reject(
        new BasicToolError(
          'INVALID_PUBLICATION',
          'The internal publication request exceeds supported limits.'
        )
      );
    }
    try {
      decodeText(input.content);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = operationKey(input.ownerId, input.taskId, input.idempotencyKey);
    const fingerprint = hash(
      Buffer.from(JSON.stringify([input.target.toLowerCase(), input.expectedVersion, hash(input.content)]))
    );
    const previous = this.operations.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return Promise.reject(
          new BasicToolError(
            'IDEMPOTENCY_CONFLICT',
            'The operation key was already used for different input.'
          )
        );
      }
      return previous.pending.then((result) => ({ ...result }));
    }
    if (this.operations.size >= 1000 || this.pendingBytes + input.content.length > 32 * 1024 * 1024) {
      return Promise.reject(
        new BasicToolError('PUBLICATION_LIMIT', 'The mutation count or queued byte limit was reached.')
      );
    }
    const owned = { ...input, content: Buffer.from(input.content) };
    this.pendingBytes += owned.content.length;
    const pending = this.tail.then(() => this.execute(owned, fingerprint));
    this.operations.set(key, { fingerprint, pending });
    this.tail = pending.then(
      () => {
        this.pendingBytes -= owned.content.length;
      },
      () => {
        this.pendingBytes -= owned.content.length;
      }
    );
    return pending.then((result) => ({ ...result }));
  }

  /**
   * Stops admission and drains every admitted mutation before releasing ownership.
   */
  async close(): Promise<void> {
    this.accepting = false;
    await this.tail;
    if (!this.ownershipReleased) {
      ownedJournals.delete(this.journal.toLowerCase());
      this.ownershipReleased = true;
    }
  }

  /**
   * Returns paths still gated by recovery, only to trusted Host management code.
   */
  getBlockedTargets(): readonly string[] {
    return [...this.blocked];
  }

  /**
   * Prevents the task service from reusing a mutation-bearing task identity after stop or Runtime restart.
   */
  hasTaskHistory(ownerId: string, taskId: string): boolean {
    for (const key of this.operations.keys()) {
      const tuple: unknown = JSON.parse(key);
      if (Array.isArray(tuple) && tuple[0] === ownerId && tuple[1] === taskId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Flushes append-only phase records. Partial records are never silently ignored on restart.
   */
  private async persist(record: Record, initial = false): Promise<void> {
    const serialized = JSON.stringify(recordSchema.parse(record)) + '\n';
    const handle = await open(join(this.journal, record.id + '.jsonl'), initial ? 'ax' : 'a');
    try {
      await handle.writeFile(serialized);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /**
   * Uses only UUID-derived same-volume evidence paths; never accepts a caller-supplied backup location.
   */
  private paths(record: Pick<Record, 'target' | 'id'>): { recovery: string; temp: string; backup: string } {
    const recovery = join(dirname(record.target), '.octopus-executor-recovery-' + record.id);
    return { recovery, temp: join(recovery, 'proposed.txt'), backup: join(recovery, 'previous.txt') };
  }

  /**
   * Checks versions before preparing evidence, then performs exactly one native publication and reads back both sides.
   */
  private async execute(input: PublicationInput, fingerprint: string): Promise<PublicationResult> {
    if (this.blocked.has(input.target.toLowerCase())) {
      throw new BasicToolError('FILE_RECOVERY_REQUIRED', 'An unresolved mutation blocks this file.');
    }
    const parent = await this.native.inspect(dirname(input.target));
    const before = await this.native.inspect(input.target);
    if (
      !parent.ok ||
      !parent.directory ||
      (!before.ok && before.nativeCode !== 2) ||
      (before.ok && (before.directory || before.links !== 1))
    ) {
      throw new BasicToolError(
        'UNSUPPORTED_FILE',
        'Publication requires an existing NTFS parent and a single-link ordinary file.'
      );
    }
    let beforeVersion = 'absent';
    let expectedHash: string | null = null;
    let oldSize = 0;
    if (before.ok) {
      const snapshot = await readTextSnapshot(input.target);
      beforeVersion = snapshot.version;
      expectedHash = hash(snapshot.bytes);
      oldSize = snapshot.bytes.length;
      const rechecked = await this.native.inspect(input.target);
      if (!rechecked.ok || rechecked.identity !== before.identity || rechecked.links !== 1) {
        throw new BasicToolError('FILE_VERSION_CONFLICT', 'The file identity changed before publication.');
      }
    }
    if (input.expectedVersion !== beforeVersion) {
      throw new BasicToolError('FILE_VERSION_CONFLICT', 'The file differs from the expected version.');
    }
    const record: Record = {
      id: randomUUID(),
      ownerId: input.ownerId,
      taskId: input.taskId,
      key: input.idempotencyKey,
      fingerprint,
      target: input.target,
      targetIdentity: before.ok ? before.identity : 'absent',
      parentIdentity: parent.identity,
      tempIdentity: 'absent',
      recoveryIdentity: 'absent',
      expectedVersion: beforeVersion,
      expectedHash,
      proposedHash: hash(input.content),
      retainedBytes: oldSize + input.content.length,
      phase: 'prepared',
    };
    if (before.ok && record.proposedHash === expectedHash) {
      record.retainedBytes = 0;
      record.phase = 'terminal';
      record.result = { status: 'no_change', version: beforeVersion, recoveryId: record.id };
      await this.persist(record, true);
      return record.result;
    }
    if (this.retainedBytes + record.retainedBytes > 256 * 1024 * 1024) {
      throw new BasicToolError('RECOVERY_QUOTA', 'Recovery evidence exceeds its 256 MiB limit.');
    }
    const paths = this.paths(record);
    const recovery = await this.native.createRecovery(paths.recovery);
    if (!recovery.ok || !recovery.privateAcl) {
      throw new BasicToolError('RECOVERY_UNAVAILABLE', 'Cannot create private same-volume evidence storage.');
    }
    record.recoveryIdentity = recovery.identity;
    const handle = await open(paths.temp, 'wx');
    try {
      await handle.writeFile(input.content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temp = await this.native.inspect(paths.temp);
    if (!temp.ok || temp.directory || temp.links !== 1) {
      throw new BasicToolError('RECOVERY_UNAVAILABLE', 'Cannot validate the prepared file.');
    }
    record.tempIdentity = temp.identity;
    this.retainedBytes += record.retainedBytes;
    await this.persist(record, true);
    try {
      record.phase = 'commit_started';
      await this.persist(record);
      const outcome = await this.native.commit({
        target: record.target,
        temp: paths.temp,
        backup: paths.backup,
        targetIdentity: record.targetIdentity,
        parentIdentity: record.parentIdentity,
        tempIdentity: record.tempIdentity,
      });
      if (!outcome.ok && !outcome.started) {
        record.result = { status: 'not_applied', nativeCode: outcome.nativeCode, recoveryId: record.id };
      } else if (!outcome.ok) {
        record.result = { status: 'uncertain', nativeCode: outcome.nativeCode, recoveryId: record.id };
      } else {
        record.result = await this.verifyApplied(record);
      }
    } catch {
      record.result = { status: 'uncertain', recoveryId: record.id };
    }
    record.phase = 'terminal';
    if (record.result.status === 'uncertain' || record.result.status === 'conflict_after_commit') {
      this.blocked.add(record.target.toLowerCase());
    }
    try {
      await this.persist(record);
    } catch {
      this.blocked.add(record.target.toLowerCase());
      return { status: 'uncertain', recoveryId: record.id };
    }
    return record.result;
  }

  /**
   * Confirms content and physical identities; mismatched old backups reveal check-to-replace external races.
   */
  private async verifyApplied(record: Record): Promise<PublicationResult> {
    const target = await this.native.inspect(record.target);
    const snapshot = await readTextSnapshot(record.target);
    const afterTarget = await this.native.inspect(record.target);
    if (
      !target.ok ||
      target.identity !== record.tempIdentity ||
      target.links !== 1 ||
      !afterTarget.ok ||
      afterTarget.identity !== target.identity ||
      afterTarget.links !== 1 ||
      hash(snapshot.bytes) !== record.proposedHash
    ) {
      return { status: 'conflict_after_commit', recoveryId: record.id };
    }
    if (record.targetIdentity !== 'absent') {
      const backup = this.paths(record).backup;
      const info = await this.native.inspect(backup);
      const saved = await readTextSnapshot(backup);
      const afterBackup = await this.native.inspect(backup);
      if (
        !info.ok ||
        !info.privateAcl ||
        info.links !== 1 ||
        !afterBackup.ok ||
        afterBackup.identity !== info.identity ||
        afterBackup.links !== 1 ||
        info.identity !== record.targetIdentity ||
        hash(saved.bytes) !== record.expectedHash
      ) {
        return { status: 'conflict_after_commit', recoveryId: record.id };
      }
    }
    return { status: 'applied', version: snapshot.version, recoveryId: record.id };
  }

  /**
   * Loads strictly framed histories and resolves only states supported by current identity/content evidence.
   * Every unresolved operation is restored as an unknown outcome and file gate, never replayed.
   */
  private async recover(): Promise<void> {
    const names = await readdir(this.journal);
    if (names.length > 1000) {
      throw new BasicToolError('RECOVERY_INVALID', 'The recovery journal exceeds its record limit.');
    }
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.jsonl$/.test(name)) {
        throw new BasicToolError('RECOVERY_INVALID', 'The recovery journal contains an unexpected entry.');
      }
      const info = await this.native.inspect(join(this.journal, name));
      if (!info.ok || info.directory || info.links !== 1 || info.size > 512 * 1024) {
        throw new BasicToolError('RECOVERY_INVALID', 'A recovery record is not a bounded ordinary file.');
      }
      const handle = await open(join(this.journal, name), 'r');
      let text: string;
      try {
        const bytes = Buffer.alloc(512 * 1024 + 1);
        let length = 0;
        while (length < bytes.length) {
          const chunk = await handle.read(bytes, length, bytes.length - length, length);
          if (chunk.bytesRead === 0) {
            break;
          }
          length += chunk.bytesRead;
        }
        if (length === bytes.length) {
          throw new BasicToolError('RECOVERY_INVALID', 'A recovery record exceeds its byte limit.');
        }
        text = decodeText(bytes.subarray(0, length));
      } finally {
        await handle.close();
      }
      if (!text.endsWith('\n')) {
        throw new BasicToolError('RECOVERY_INVALID', 'A recovery record is incomplete.');
      }
      const lines = text.slice(0, -1).split('\n');
      let record: Record | undefined;
      for (const line of lines) {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          throw new BasicToolError('RECOVERY_INVALID', 'A recovery record contains invalid JSON.');
        }
        const parsed = recordSchema.safeParse(value);
        if (!parsed.success || parsed.data.id + '.jsonl' !== name) {
          throw new BasicToolError('RECOVERY_INVALID', 'A recovery record has invalid fields.');
        }
        if (
          !record &&
          (parsed.data.phase === 'commit_started' ||
            (parsed.data.phase === 'terminal' && parsed.data.result?.status !== 'no_change'))
        ) {
          throw new BasicToolError('RECOVERY_INVALID', 'A recovery history has no valid initial phase.');
        }
        if (
          record &&
          (JSON.stringify({ ...parsed.data, phase: undefined, result: undefined }) !==
            JSON.stringify({ ...record, phase: undefined, result: undefined }) ||
            record.phase === 'terminal' ||
            parsed.data.phase === 'prepared' ||
            (record.phase === 'commit_started' && parsed.data.phase !== 'terminal'))
        ) {
          throw new BasicToolError('RECOVERY_INVALID', 'A recovery history changes its operation identity.');
        }
        if (parsed.data.result && parsed.data.result.recoveryId !== parsed.data.id) {
          throw new BasicToolError(
            'RECOVERY_INVALID',
            'A terminal result has a different recovery identity.'
          );
        }
        record = parsed.data;
      }
      if (!record || (record.phase === 'terminal') !== (record.result !== undefined)) {
        throw new BasicToolError('RECOVERY_INVALID', 'A recovery record has an invalid terminal state.');
      }
      this.retainedBytes += record.retainedBytes;
      if (this.retainedBytes > 256 * 1024 * 1024) {
        throw new BasicToolError('RECOVERY_QUOTA', 'Recorded recovery materials exceed the quota.');
      }
      if (record.phase !== 'terminal') {
        let result: PublicationResult = { status: 'uncertain', recoveryId: record.id };
        try {
          const recovery = await this.native.inspect(this.paths(record).recovery);
          if (recovery.ok && recovery.privateAcl && recovery.identity === record.recoveryIdentity) {
            if (record.phase === 'prepared') {
              const target = await this.native.inspect(record.target);
              const absent = !target.ok && target.nativeCode === 2 && record.targetIdentity === 'absent';
              const unchanged =
                target.ok &&
                target.identity === record.targetIdentity &&
                (await readTextSnapshot(record.target)).version === record.expectedVersion;
              if (absent || unchanged) {
                result = { status: 'not_applied', recoveryId: record.id };
              }
            } else {
              result = await this.verifyApplied(record);
            }
          }
        } catch {
          result = { status: 'uncertain', recoveryId: record.id };
        }
        record.phase = 'terminal';
        record.result = result;
        await this.persist(record);
      }
      const result = record.result;
      if (!result) {
        throw new BasicToolError('RECOVERY_INVALID', 'Recovery produced no terminal result.');
      }
      const key = operationKey(record.ownerId, record.taskId, record.key);
      if (this.operations.has(key)) {
        throw new BasicToolError('RECOVERY_INVALID', 'The journal contains duplicate operation keys.');
      }
      this.operations.set(key, { fingerprint: record.fingerprint, pending: Promise.resolve(result) });
      if (result.status === 'uncertain' || result.status === 'conflict_after_commit') {
        this.blocked.add(record.target.toLowerCase());
      }
    }
  }
}
