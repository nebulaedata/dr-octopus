/**
 * @author Codex
 * @description Owns immutable SID-private browser consent and per-Runtime bootstrap records.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { NativeFileCommit } from '../basic/native-file-commit';

export const bridgeBootstrapSchema = z.strictObject({
  sequence: z.number().int().min(1).max(1000),
  enabled: z.boolean(),
  endpoint: z.string().regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/browser-bridge$/),
  credential: z.string().regex(/^[a-f0-9]{64}$/),
  loginIdentity: z.string().regex(/^-?\d+:\d+:\d+$/),
});
export type BridgeBootstrap = z.infer<typeof bridgeBootstrapSchema>;
export class BridgeStore {
  private current: BridgeBootstrap | null = null;
  private writing = false;
  private failed = false;
  /**
   * Binds one Runtime writer to protected immutable bootstrap history.
   */
  private constructor(
    private readonly native: NativeFileCommit,
    readonly root: string
  ) {}
  /**
   * Adopts only complete sequential private records, refusing corrupt metadata and excessive history.
   */
  static async open(native: NativeFileCommit, data: string): Promise<BridgeStore> {
    const root = join(data, 'browser');
    const created = await native.createRecovery(root);
    if (!created.ok && created.nativeCode !== 183) {
      throw new Error('Browser store unavailable');
    }
    const directory = await native.inspect(root);
    if (!directory.ok || !directory.directory || !directory.privateAcl) {
      throw new Error('Browser store protection invalid');
    }
    const store = new BridgeStore(native, root);
    const names = (await readdir(root)).sort();
    if (names.length > 1000) {
      throw new Error('Browser history full');
    }
    for (const [index, name] of names.entries()) {
      if (name !== `${String(index + 1).padStart(4, '0')}.json`) {
        throw new Error('Browser history invalid');
      }
      const record = await readBootstrap(native, join(root, name));
      if (record.sequence !== index + 1) {
        throw new Error('Browser history invalid');
      }
      store.current = record;
    }
    return store;
  }
  /**
   * Returns the persisted user choice; first installation always starts disabled.
   */
  enabled(): boolean {
    return this.current?.enabled ?? false;
  }
  /**
   * Commits fresh credentials before publishing changes; no existing file is replaced.
   */
  async save(endpoint: string, enabled: boolean): Promise<BridgeBootstrap> {
    if (this.writing || this.failed) {
      throw new Error('Browser store unavailable');
    }
    this.writing = true;
    try {
      const record = bridgeBootstrapSchema.parse({
        sequence: (this.current?.sequence ?? 0) + 1,
        enabled,
        endpoint,
        credential: randomBytes(32).toString('hex'),
        loginIdentity: this.native.loginIdentity(),
      });
      const written = await this.native.writePrivateConfig(
        join(this.root, `${String(record.sequence).padStart(4, '0')}.json`),
        JSON.stringify(record)
      );
      if (!written.ok || !written.privateAcl) {
        this.failed = true;
        throw new Error('Browser store write failed');
      }
      this.current = record;
      return record;
    } finally {
      this.writing = false;
    }
  }
}
/**
 * Reads a complete private single-link bootstrap without following reparse paths or adopting open ACLs.
 */
export async function readBootstrap(native: NativeFileCommit, path: string): Promise<BridgeBootstrap> {
  const info = await native.inspect(path);
  if (!info.ok || info.directory || !info.privateAcl || info.links !== 1 || info.size > 4096) {
    throw new Error('Browser bootstrap invalid');
  }
  const read = await native.readSnapshot(path);
  if (!read.ok || read.identity !== info.identity || read.bytes.length > 4096) {
    throw new Error('Browser bootstrap changed');
  }
  return bridgeBootstrapSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes))
  );
}
