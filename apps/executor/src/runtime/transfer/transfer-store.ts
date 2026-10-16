/**
 * @author Codex
 * @description Persists bounded transfer outcomes and preserves uncertain publication evidence across restarts.
 */
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { transferResultSchema, transferDigestSchema } from './transfer-inputs';
import type { NativeFileCommit } from '../basic/native-file-commit';

export const transferRecordSchema = transferResultSchema.extend({
  ownerId: z.uuid(),
  key: z.string().min(1).max(128),
  fingerprint: transferDigestSchema,
  expectedSha256: transferDigestSchema.optional(),
  directory: z.string().max(4096),
  reservedBytes: z.number().int().nonnegative(),
  materialIdentity: z.string().max(128).optional(),
  updatedAt: z.number().int(),
  directoryIdentity: z.string().max(128).optional(),
  finishedAt: z.number().int().optional(),
});
export type TransferRecord = z.infer<typeof transferRecordSchema>;

export class TransferStore {
  readonly records = new Map<string, TransferRecord>();
  private tail: Promise<void> = Promise.resolve();
  private failed = false;
  private bytes = 0;
  /**
   * Uses a host-owned private journal directory; no paths are accepted from model arguments.
   */
  private constructor(
    readonly root: string,
    readonly materialRoot: string
  ) {}

  /**
   * Refuses malformed journals and incomplete trailing records instead of inventing commit outcomes.
   */
  static async open(native: NativeFileCommit, projectData: string): Promise<TransferStore> {
    const materialRoot = join(projectData, 'transfers');
    const root = join(projectData, 'transfers');
    const created = await native.createRecovery(root);
    if (!created.ok && created.nativeCode !== 183) {
      throw new Error('Transfer store creation failed');
    }
    const info = await native.inspect(root);
    if (!info.ok || !info.directory || !info.privateAcl) {
      throw new Error('Transfer store is not private');
    }
    const store = new TransferStore(root, materialRoot);
    const names = await readdir(root);
    if (names.includes('events.jsonl')) {
      const read = await native.readSnapshot(join(root, 'events.jsonl'));
      if (!read.ok || read.bytes.length > 8 * 1024 ** 2 || read.bytes.at(-1) !== 10) {
        throw new Error('Invalid transfer journal');
      }
      store.bytes = read.bytes.length;
      for (const line of read.bytes.toString('utf8').trimEnd().split('\n')) {
        const record = transferRecordSchema.parse(JSON.parse(line));
        store.records.set(record.transferId, record);
      }
    }
    return store;
  }

  /**
   * Flushes a bounded outcome before returning; a failed persistence chain closes future writes.
   */
  async save(record: TransferRecord): Promise<void> {
    record.updatedAt = Date.now();
    if (['completed', 'cancelled', 'failed', 'expired'].includes(record.status)) {
      record.finishedAt ??= Date.now();
    }
    const line = JSON.stringify(transferRecordSchema.parse(record)) + '\n';
    const saving = this.tail.then(async () => {
      if (this.failed || this.bytes + Buffer.byteLength(line) > 8 * 1024 ** 2) {
        throw new Error('Transfer journal unavailable');
      }
      const handle = await open(join(this.root, 'events.jsonl'), 'a', 0o600);
      try {
        await handle.writeFile(line);
        await handle.sync();
        this.bytes += Buffer.byteLength(line);
      } finally {
        await handle.close();
      }
    });
    this.tail = saving.catch(() => {
      this.failed = true;
    });
    await saving;
  }
}
