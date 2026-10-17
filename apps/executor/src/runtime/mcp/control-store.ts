/**
 * @author Codex
 * @description Persists private authorization and task creation records before admission, without sensitive tool contents.
 */
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { BasicToolError } from '../basic/basic-inputs';
import type { NativeFileCommit } from '../basic/native-file-commit';
import { computerNames, computerSchemas } from '../computer/computer-inputs';
import { clientSummarySchema, executorPermissionSchema } from '../../contracts/access';

export const grantSchema = clientSummarySchema.extend({ tokenHash: z.string().regex(/^[a-f0-9]{64}$/) });
const summarySchema = z.strictObject({
  key: z.string().min(1).max(128),
  tool: z.enum([
    'read',
    'write',
    'edit',
    'powershell',
    'grep',
    'find',
    'ls',
    'file_upload_prepare',
    'file_download_prepare',
    'browser_open_tab',
    'browser_navigate',
    'browser_close_tab',
    'browser_snapshot',
    'browser_read_snapshot',
    'browser_click',
    'browser_fill',
    'browser_select',
    'browser_scroll',
    ...computerNames,
  ]),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['pending', 'completed', 'failed', 'unknown']),
  effectiveTimeout: z.number().int().min(1).max(600).optional(),
  code: z.string().max(100).optional(),
  effect: z.string().max(30).optional(),
  version: z.string().max(256).optional(),
});
export const taskRecordSchema = z.strictObject({
  taskId: z.uuid(),
  clientId: z.uuid(),
  creationKey: z.string().min(1).max(128),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  connectionId: z.uuid().optional(),
  capabilities: z.array(executorPermissionSchema).min(1).max(6),
  cwd: z.string().max(4096),
  state: z.enum(['created', 'active', 'stopping', 'completed', 'cancelled', 'failed', 'interrupted']),
  quarantined: z.boolean(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  operations: z.array(summarySchema).max(1000),
});
export type Grant = z.infer<typeof grantSchema>;
export type TaskRecord = z.infer<typeof taskRecordSchema>;
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('grant'), sequence: z.number().int().positive(), value: grantSchema }),
  z.strictObject({ kind: z.literal('task'), sequence: z.number().int().positive(), value: taskRecordSchema }),
]);
const owned = new Set<string>();

export class ControlStore {
  readonly grants = new Map<string, Grant>();
  readonly tasks = new Map<string, TaskRecord>();
  private sequence = 0;
  private bytes = 0;
  private tail: Promise<void> = Promise.resolve();
  private failed = false;
  private closed = false;

  /**
   * Binds one Runtime writer to a SID-private journal path.
   */
  private constructor(
    private readonly native: NativeFileCommit,
    private readonly root: string
  ) {}

  /**
   * Loads complete bounded records and marks old live tasks interrupted; never replays tool calls.
   */
  static async open(native: NativeFileCommit, data: string): Promise<ControlStore> {
    const root = join(data, 'tasks');
    if (owned.has(root.toLowerCase())) {
      throw new BasicToolError('CONTROL_STORE_BUSY', 'The control store already has an owner.');
    }
    owned.add(root.toLowerCase());
    const store = new ControlStore(native, root);
    try {
      const inspected = await native.inspect(root);
      if (!inspected.ok && inspected.nativeCode === 2) {
        const created = await native.createRecovery(root);
        if (!created.ok || !created.privateAcl) {
          throw new BasicToolError('CONTROL_STORE_INVALID', 'Private control storage could not be created.');
        }
      } else if (!inspected.ok || !inspected.directory || !inspected.privateAcl) {
        throw new BasicToolError('CONTROL_STORE_INVALID', 'Private control storage is invalid.');
      }
      const names = await readdir(root);
      if (names.some((name) => name !== 'events.jsonl')) {
        throw new BasicToolError('CONTROL_STORE_INVALID', 'Unknown control material was retained.');
      }
      if (names.length) {
        const read = await native.readSnapshot(join(root, 'events.jsonl'));
        if (!read.ok || read.bytes.length > 8 * 1024 * 1024 || read.bytes.at(-1) !== 10) {
          throw new BasicToolError(
            'CONTROL_STORE_INVALID',
            'Incomplete or oversized control history was retained.'
          );
        }
        store.bytes = read.bytes.length;
        const text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
        for (const line of text.trimEnd().split('\n')) {
          const event = eventSchema.parse(JSON.parse(line));
          if (event.sequence !== store.sequence + 1) {
            throw new BasicToolError('CONTROL_STORE_INVALID', 'Control event ordering is invalid.');
          }
          store.sequence = event.sequence;
          store.recover(event);
        }
      }
      for (const task of store.tasks.values()) {
        if (['created', 'active', 'stopping'].includes(task.state)) {
          for (const operation of task.operations) {
            if (operation.state === 'pending') {
              operation.state = 'unknown';
              task.quarantined ||=
                ['write', 'edit', 'powershell'].includes(operation.tool) ||
                Object.hasOwn(computerSchemas, operation.tool);
            }
          }
          task.state = 'interrupted';
          task.updatedAt = Date.now();
          await store.saveTask(task);
        }
      }
      return store;
    } catch (error) {
      await store.close();
      if (error instanceof BasicToolError) {
        throw error;
      }
      throw new BasicToolError('CONTROL_STORE_INVALID', 'Control history could not be validated.');
    }
  }

  /**
   * Appends a grant before acknowledging local approval or revocation.
   */
  async saveGrant(value: Grant): Promise<void> {
    await this.append({ kind: 'grant', value: grantSchema.parse(structuredClone(value)), sequence: 1 });
    this.grants.set(value.clientId, value);
  }

  /**
   * Appends the detached task snapshot before returning its lifecycle transition.
   */
  async saveTask(value: TaskRecord): Promise<void> {
    await this.append({ kind: 'task', value: taskRecordSchema.parse(structuredClone(value)), sequence: 1 });
    this.tasks.set(value.taskId, value);
  }

  /**
   * Flushes the sole writer and releases ownership exactly once.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.tail;
    owned.delete(this.root.toLowerCase());
  }

  /**
   * Refuses changing immutable owner/creation/grant fields while replaying complete history.
   */
  private recover(event: z.infer<typeof eventSchema>): void {
    if (event.kind === 'grant') {
      const prior = this.grants.get(event.value.clientId);
      if (
        prior &&
        (JSON.stringify({ ...prior, revoked: false }) !==
          JSON.stringify({ ...event.value, revoked: false }) ||
          prior.revoked)
      ) {
        throw new BasicToolError('CONTROL_STORE_INVALID', 'A grant changed its immutable authorization.');
      }
      if (!prior && (event.value.revoked || this.grants.size >= 100)) {
        throw new BasicToolError('CONTROL_STORE_INVALID', 'Grant history exceeds its limits.');
      }
      this.grants.set(event.value.clientId, event.value);
      return;
    }
    const task = event.value;
    const prior = this.tasks.get(task.taskId);
    const grant = this.grants.get(task.clientId);
    if (!grant || !task.capabilities.every((cap) => grant.permissions.includes(cap))) {
      throw new BasicToolError('CONTROL_STORE_INVALID', 'Task history exceeds its original grant.');
    }
    if (
      prior &&
      ['clientId', 'creationKey', 'fingerprint', 'createdAt', 'cwd', 'capabilities'].some(
        (key) =>
          JSON.stringify(prior[key as keyof TaskRecord]) !== JSON.stringify(task[key as keyof TaskRecord])
      )
    ) {
      throw new BasicToolError('CONTROL_STORE_INVALID', 'Task ownership or creation history changed.');
    }
    if (
      !prior &&
      (task.state !== 'created' ||
        this.tasks.size >= 1000 ||
        [...this.tasks.values()].some(
          (value) => value.clientId === task.clientId && value.creationKey === task.creationKey
        ))
    ) {
      throw new BasicToolError('CONTROL_STORE_INVALID', 'Task creation history is invalid.');
    }
    if (
      !prior &&
      (task.operations.length ||
        task.quarantined ||
        [...this.tasks.values()].some(
          (value) => value.quarantined || ['created', 'active', 'stopping'].includes(value.state)
        ))
    ) {
      throw new BasicToolError('CONTROL_STORE_INVALID', 'Task history violates exclusive admission.');
    }
    if (prior) {
      const transitions: Record<TaskRecord['state'], TaskRecord['state'][]> = {
        created: ['created', 'active', 'stopping', 'failed', 'interrupted'],
        active: ['active', 'stopping', 'failed', 'interrupted'],
        stopping: ['stopping', 'completed', 'cancelled', 'interrupted'],
        completed: ['completed'],
        cancelled: ['cancelled'],
        failed: ['failed'],
        interrupted: ['interrupted'],
      };
      if (
        !transitions[prior.state].includes(task.state) ||
        (prior.quarantined && !task.quarantined) ||
        task.operations.length < prior.operations.length
      ) {
        throw new BasicToolError('CONTROL_STORE_INVALID', 'Task lifecycle regressed.');
      }
      for (let index = 0; index < task.operations.length; index++) {
        const operation = task.operations[index]!;
        const before = prior.operations[index];
        if (
          (!before && (operation.state !== 'pending' || task.state !== 'active')) ||
          (before &&
            (['key', 'tool', 'fingerprint', 'effectiveTimeout'].some(
              (key) =>
                JSON.stringify(before[key as keyof typeof before]) !==
                JSON.stringify(operation[key as keyof typeof operation])
            ) ||
              (before.state !== 'pending' && JSON.stringify(before) !== JSON.stringify(operation))))
        ) {
          throw new BasicToolError(
            'CONTROL_STORE_INVALID',
            'Operation history changed or replayed a terminal outcome.'
          );
        }
      }
    }
    if (new Set(task.operations.map((operation) => operation.key)).size !== task.operations.length) {
      throw new BasicToolError('CONTROL_STORE_INVALID', 'Operation keys are duplicated.');
    }
    this.tasks.set(task.taskId, task);
  }

  /**
   * Serializes bounded durable writes; any persistence failure closes subsequent control admission.
   */
  private append(event: z.infer<typeof eventSchema>): Promise<void> {
    if (this.closed || this.failed) {
      return Promise.reject(
        new BasicToolError('CONTROL_STORE_FAILED', 'Control persistence requires inspection.')
      );
    }
    const pending = this.tail.then(async () => {
      if (this.failed) {
        throw new BasicToolError('CONTROL_STORE_FAILED', 'Control persistence requires inspection.');
      }
      const line = Buffer.from(JSON.stringify({ ...event, sequence: this.sequence + 1 }) + '\n');
      if (this.bytes + line.length > 8 * 1024 * 1024) {
        throw new BasicToolError('CONTROL_STORE_FULL', 'Control history reached its retained limit.');
      }
      const directory = await this.native.inspect(this.root);
      if (!directory.ok || !directory.directory || !directory.privateAcl) {
        throw new BasicToolError(
          'CONTROL_STORE_FAILED',
          'Control storage no longer has its required protection.'
        );
      }
      const file = await this.native.inspect(join(this.root, 'events.jsonl'));
      if ((!file.ok && file.nativeCode !== 2) || (file.ok && (file.directory || file.links !== 1))) {
        throw new BasicToolError(
          'CONTROL_STORE_FAILED',
          'Control history no longer has its required protection.'
        );
      }
      const handle = await open(join(this.root, 'events.jsonl'), 'a');
      try {
        await handle.writeFile(line);
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.sequence++;
      this.bytes += line.length;
    });
    this.tail = pending.catch(() => {
      this.failed = true;
    });
    return pending;
  }
}
