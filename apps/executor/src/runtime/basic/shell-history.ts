/**
 * @author Codex
 * @description Persists shell admission and sealed output ownership, prevents replay and cleans verified private artifacts.
 */
import { randomUUID } from 'node:crypto';
import { open, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { BasicToolError } from './basic-inputs';
import type { NativeFileCommit } from './native-file-commit';
import type { ShellResult } from './shell-executor';

const capacity = 256 * 1024 * 1024;
const reservation = 64 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const outcome = z.strictObject({
  output: z.string().refine((text) => Buffer.byteLength(text) <= 51200),
  exitCode: z.number().int().min(0).max(0xffffffff),
  durationMs: z.number().int().nonnegative(),
  effectiveTimeoutMs: z.number().int().min(1).max(600000),
  terminationReason: z.enum([
    'completed',
    'launch_failed',
    'timeout',
    'cancelled',
    'output_limit',
    'background_process_rejected',
  ]),
  executionState: z.literal('quiescent'),
  businessEffect: z.enum(['unknown', 'not_applied']),
  truncated: z.boolean(),
  replacementUsed: z.boolean(),
  outputArtifact: z.strictObject({
    uri: z.string().max(128),
    stdoutBytes: z.number().int().nonnegative(),
    stderrBytes: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime(),
  }),
});
const artifact = z.strictObject({
  identity: z.string().min(1).max(128),
  lengths: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  digests: z.tuple([hash, hash]),
  identities: z.tuple([z.string().min(1).max(128), z.string().min(1).max(128)]),
});
const schema = z.strictObject({
  schemaVersion: z.literal(2),
  shell: z.literal('windows-powershell-5.1'),
  id: z.uuid(),
  ownerId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
  key: z.string().min(1).max(128),
  fingerprint: hash,
  created: z.number().int().nonnegative(),
  expires: z.number().int().nonnegative(),
  phase: z.enum(['admitted', 'dispatched', 'sealed', 'failed', 'revoked', 'deleted']),
  artifact: artifact.optional(),
  result: outcome.optional(),
  error: z.enum(['SHELL_NOT_STARTED', 'SHELL_RESULT_UNKNOWN']).optional(),
});
type Record = z.infer<typeof schema>;
const owned = new Set<string>();

/**
 * Encodes a stable operation tuple independently from filenames.
 */
function key(owner: string, task: string, operation: string): string {
  return JSON.stringify([owner, task, operation]);
}

export class ShellHistory {
  private readonly records = new Map<string, Record>();
  private tail: Promise<void> = Promise.resolve();
  private released = false;

  /**
   * Owns one private ledger; all paths are derived from validated UUIDs beneath this directory.
   */
  private constructor(
    private readonly native: NativeFileCommit,
    private readonly root: string
  ) {}

  /**
   * Recovers bounded append histories without launching commands or adopting unknown resources.
   */
  static async open(native: NativeFileCommit, data: string): Promise<ShellHistory> {
    const root = resolve(data, 'shell');
    if (!isAbsolute(data) || owned.has(root.toLowerCase())) {
      throw new BasicToolError('SHELL_HISTORY_IN_USE', 'Shell history is unavailable or already owned.');
    }
    owned.add(root.toLowerCase());
    try {
      const created = await native.createRecovery(root);
      const info = await native.inspect(root);
      if ((!created.ok && created.nativeCode !== 183) || !info.ok || !info.directory || !info.privateAcl) {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell history is not private NTFS storage.');
      }
      const history = new ShellHistory(native, root);
      await history.recover();
      await history.cleanup();
      return history;
    } catch (error) {
      owned.delete(root.toLowerCase());
      if (error instanceof BasicToolError) {
        throw error;
      }
      throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell history could not be validated.');
    }
  }

  /**
   * Refuses fresh registration of a shell-bearing task after Runtime restart.
   */
  hasTask(ownerId: string, taskId: string): boolean {
    return [...this.records.values()].some(
      (record) => record.ownerId === ownerId && record.taskId === taskId
    );
  }

  /**
   * Retrieves only the same owner/task/key/input outcome; unfinished admission cannot trigger replay.
   */
  lookup(ownerId: string, taskId: string, operation: string, fingerprint: string): ShellResult | undefined {
    const record = this.records.get(key(ownerId, taskId, operation));
    if (!record) {
      return undefined;
    }
    if (record.fingerprint !== fingerprint) {
      throw new BasicToolError('IDEMPOTENCY_CONFLICT', 'The persisted shell operation has different input.');
    }
    if (!record.result) {
      throw new BasicToolError(
        record.error ?? 'SHELL_RESULT_UNKNOWN',
        'The prior shell call has no confirmed result and will not be replayed.'
      );
    }
    return structuredClone(record.result);
  }

  /**
   * Derives the private operation directory; UUIDs are checked before any filesystem operation.
   */
  directory(id: string): string {
    if (!z.uuid().safeParse(id).success) {
      throw new BasicToolError('SHELL_HISTORY_INVALID', 'Invalid shell storage identity.');
    }
    return join(this.root, `.octopus-executor-recovery-${id}`);
  }

  /**
   * Flushes admission before any process creation and reserves worst-case raw output across restarts.
   */
  async admit(input: {
    ownerId: string;
    taskId: string;
    idempotencyKey: string;
    fingerprint: string;
  }): Promise<string> {
    return this.serialize(async () => {
      if (this.released) {
        throw new BasicToolError('SHELL_HISTORY_CLOSED', 'Shell history is closed.');
      }
      if (this.records.has(key(input.ownerId, input.taskId, input.idempotencyKey))) {
        throw new BasicToolError('IDEMPOTENCY_CONFLICT', 'Shell admission already exists.');
      }
      if (this.records.size >= 1000 || this.retained() + reservation > capacity) {
        throw new BasicToolError(
          'SHELL_OUTPUT_QUOTA',
          'The persisted shell history or output quota was reached.'
        );
      }
      const now = Date.now();
      const record: Record = {
        schemaVersion: 2,
        shell: 'windows-powershell-5.1',
        id: randomUUID(),
        ownerId: input.ownerId,
        taskId: input.taskId,
        key: input.idempotencyKey,
        fingerprint: input.fingerprint,
        created: now,
        expires: now + 86400000,
        phase: 'admitted',
      };
      await this.append(record, true);
      this.records.set(key(record.ownerId, record.taskId, record.key), record);
      return record.id;
    });
  }

  /**
   * Flushes the potentially-effective boundary immediately before spawning the supervisor.
   */
  async dispatch(id: string): Promise<void> {
    await this.change(id, (record) => {
      if (record.phase !== 'admitted') {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell dispatch ordering is invalid.');
      }
      return { ...record, phase: 'dispatched' };
    });
  }

  /**
   * Persists verified stream identities/hashes and the exact completed result before returning it to the caller.
   */
  async seal(id: string, material: z.infer<typeof artifact>, result: ShellResult): Promise<void> {
    await this.change(id, (record) => {
      if (record.phase !== 'dispatched') {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell sealing ordering is invalid.');
      }
      return {
        ...record,
        phase: 'sealed',
        artifact: material,
        result: {
          ...result,
          outputArtifact: { ...result.outputArtifact, expiresAt: new Date(record.expires).toISOString() },
        },
      };
    });
  }

  /**
   * Retains failures as a replay barrier; post-dispatch failures make no quiescence assertion.
   */
  async fail(id: string): Promise<void> {
    const current = [...this.records.values()].find((record) => record.id === id);
    if (current && current.phase !== 'admitted' && current.phase !== 'dispatched') {
      return;
    }
    await this.change(id, (record) =>
      record.phase === 'sealed'
        ? record
        : {
            ...record,
            phase: 'failed',
            error: record.phase === 'admitted' ? 'SHELL_NOT_STARTED' : 'SHELL_RESULT_UNKNOWN',
          }
    );
  }

  /**
   * Authorizes sealed output by source owner/task; expiry and revocation never grant ordinary file access.
   */
  output(
    ownerId: string,
    taskId: string,
    id: string
  ): {
    directory: string;
    expires: number;
    lengths: [number, number];
    digests: [string, string];
    identities: [string, string];
  } {
    const record = [...this.records.values()].find((item) => item.id === id);
    if (
      !record ||
      record.ownerId !== ownerId ||
      record.taskId !== taskId ||
      record.phase !== 'sealed' ||
      record.expires <= Date.now() ||
      !record.artifact
    ) {
      throw new BasicToolError('OUTPUT_NOT_FOUND', 'No retained shell output is authorized.');
    }
    return { directory: this.directory(id), expires: record.expires, ...structuredClone(record.artifact) };
  }

  /**
   * Revokes completed source-task output immediately and then attempts safe physical cleanup.
   */
  async revoke(ownerId: string, taskId: string): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (record.ownerId === ownerId && record.taskId === taskId && record.phase === 'sealed') {
        await this.change(record.id, (value) => ({ ...value, phase: 'revoked' }));
      }
    }
    await this.cleanup();
  }

  /**
   * Deletes only confirmed completed, expired/revoked material; failed cleanup retains its quota reservation.
   * Every descendant is checked for ordinary NTFS identity before the verified private root is recursively removed.
   */
  async cleanup(): Promise<void> {
    await this.serialize(async () => {
      if (this.released) {
        return;
      }
      for (const original of [...this.records.values()]) {
        let record = original;
        if (record.phase === 'sealed' && record.expires <= Date.now()) {
          record = { ...record, phase: 'revoked' };
          await this.append(record);
          this.replace(record);
        }
        if (record.phase !== 'revoked' || !record.artifact) {
          continue;
        }
        const target = resolve(this.directory(record.id));
        const distance = relative(this.root, target);
        if (!distance || distance.startsWith('..') || isAbsolute(distance)) {
          throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell cleanup escaped private storage.');
        }
        const info = await this.native.inspect(target);
        if (!info.ok && info.nativeCode === 2) {
          record = { ...record, phase: 'deleted' };
          await this.append(record);
          this.replace(record);
          continue;
        }
        if (!info.ok || !info.directory || !info.privateAcl || info.identity !== record.artifact.identity) {
          continue;
        }
        try {
          const queue = [target];
          let entries = 0;
          while (queue.length) {
            const path = queue.pop()!;
            const item = await this.native.inspect(path);
            const inside = relative(target, path);
            if (!item.ok || inside.startsWith('..') || isAbsolute(inside) || ++entries > 4096) {
              throw new BasicToolError(
                'OUTPUT_CHANGED',
                'Shell cleanup requires ordinary bounded private files.'
              );
            }
            if (item.directory) {
              queue.push(...(await readdir(path)).map((name) => join(path, name)));
            }
          }
          await rm(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 });
          record = { ...record, phase: 'deleted' };
          await this.append(record);
          this.replace(record);
        } catch {
          // Access stays revoked. Keep evidence and quota; retry on later cleanup rather than claiming deletion.
        }
      }
    });
  }

  /**
   * Drains persistence before releasing Runtime ownership; retained tombstones continue to prevent replay.
   */
  async close(): Promise<void> {
    await this.tail;
    if (!this.released) {
      this.released = true;
      owned.delete(this.root.toLowerCase());
    }
  }

  /**
   * Counts sealed bytes and uncertain reservations; deleted artifacts release bytes but retain operation identity.
   */
  private retained(): number {
    return [...this.records.values()].reduce(
      (sum, record) =>
        sum +
        (record.phase === 'deleted'
          ? 0
          : record.artifact
            ? record.artifact.lengths[0] + record.artifact.lengths[1]
            : reservation),
      0
    );
  }

  /**
   * Serializes metadata transitions independently from parallel pipe draining.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work);
    this.tail = pending.then(
      () => {},
      () => {}
    );
    return pending;
  }

  /**
   * Finds an admitted operation and persists a complete next record before replacing memory state.
   */
  private async change(id: string, update: (record: Record) => Record): Promise<void> {
    await this.serialize(async () => {
      const record = [...this.records.values()].find((value) => value.id === id);
      if (!record) {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'No shell admission exists.');
      }
      const next = update(record);
      await this.append(next);
      this.replace(next);
    });
  }

  /**
   * Updates a tuple only after its durable transition completes.
   */
  private replace(record: Record): void {
    this.records.set(key(record.ownerId, record.taskId, record.key), record);
  }

  /**
   * Flushes newline-framed records; incomplete persistence fails closed on the next startup.
   */
  private async append(record: Record, initial = false): Promise<void> {
    const text = JSON.stringify(schema.parse(record)) + '\n';
    const handle = await open(join(this.root, record.id + '.jsonl'), initial ? 'ax' : 'a');
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /**
   * Checks immutable identity, phase order and output/result consistency before adopting persisted history.
   */
  private async recover(): Promise<void> {
    const names = await readdir(this.root);
    if (names.length > 2000) {
      throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell history exceeds its entry limit.');
    }
    const dirs = new Set(names.filter((name) => /^\.octopus-executor-recovery-[0-9a-f-]{36}$/.test(name)));
    for (const name of names) {
      if (/^\.octopus-executor-recovery-[0-9a-f-]{36}$/.test(name)) {
        continue;
      }
      if (!/^[0-9a-f-]{36}\.jsonl$/.test(name)) {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'Unexpected shell history entry.');
      }
      const path = join(this.root, name);
      const info = await this.native.inspect(path);
      if (!info.ok || info.directory || info.links !== 1 || info.size > 1024 * 1024) {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'Invalid shell history file.');
      }
      const handle = await open(path, 'r');
      const bytes = Buffer.alloc(1024 * 1024 + 1);
      let length = 0;
      try {
        while (length < bytes.length) {
          const read = await handle.read(bytes, length, bytes.length - length, length);
          if (!read.bytesRead) {
            break;
          }
          length += read.bytesRead;
        }
      } finally {
        await handle.close();
      }
      if (length === bytes.length || bytes[length - 1] !== 10) {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell history is incomplete or oversized.');
      }
      let record: Record | undefined;
      const transitions: { [P in Record['phase']]: Record['phase'][] } = {
        admitted: ['dispatched', 'failed'],
        dispatched: ['sealed', 'failed'],
        sealed: ['revoked'],
        revoked: ['deleted'],
        deleted: [],
        failed: [],
      };
      for (const line of new TextDecoder('utf-8', { fatal: true })
        .decode(bytes.subarray(0, length - 1))
        .split('\n')) {
        const next = schema.parse(JSON.parse(line));
        /**
         * Compares immutable admission identity without including fields added by later lifecycle phases.
         */
        const identity = (value: Record): string =>
          JSON.stringify([
            value.id,
            value.ownerId,
            value.taskId,
            value.key,
            value.fingerprint,
            value.created,
            value.expires,
          ]);
        if (
          next.id + '.jsonl' !== name ||
          next.expires !== next.created + 86400000 ||
          (!record && next.phase !== 'admitted') ||
          (record &&
            (identity(record) !== identity(next) ||
              !transitions[record.phase].includes(next.phase) ||
              (record.result && JSON.stringify(record.result) !== JSON.stringify(next.result)) ||
              (record.artifact && JSON.stringify(record.artifact) !== JSON.stringify(next.artifact))))
        ) {
          throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell history identity or ordering changed.');
        }
        const sealed = ['sealed', 'revoked', 'deleted'].includes(next.phase);
        if (
          sealed !== Boolean(next.result && next.artifact) ||
          (!sealed && Boolean(next.result || next.artifact)) ||
          (next.phase === 'failed') !== Boolean(next.error)
        ) {
          throw new BasicToolError('SHELL_HISTORY_INVALID', 'Shell history terminal fields are invalid.');
        }
        if (
          next.artifact &&
          next.result &&
          (next.artifact.lengths[0] + next.artifact.lengths[1] > reservation ||
            next.result.outputArtifact.uri !== `executor-output://${next.id}` ||
            next.result.outputArtifact.stdoutBytes !== next.artifact.lengths[0] ||
            next.result.outputArtifact.stderrBytes !== next.artifact.lengths[1] ||
            next.result.outputArtifact.expiresAt !== new Date(next.expires).toISOString())
        ) {
          throw new BasicToolError(
            'SHELL_HISTORY_INVALID',
            'Shell output metadata does not match the result.'
          );
        }
        record = next;
      }
      if (!record || this.records.has(key(record.ownerId, record.taskId, record.key))) {
        throw new BasicToolError('SHELL_HISTORY_INVALID', 'Duplicate or empty shell history.');
      }
      this.replace(record);
      dirs.delete(`.octopus-executor-recovery-${record.id}`);
      if (record.phase === 'admitted' || record.phase === 'dispatched') {
        await this.fail(record.id);
      }
    }
    if (dirs.size || this.records.size > 1000 || this.retained() > capacity) {
      throw new BasicToolError('SHELL_HISTORY_INVALID', 'Unowned shell material or invalid quota.');
    }
  }
}
