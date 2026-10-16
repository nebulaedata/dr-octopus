/**
 * @author Codex
 * @description Owns protected append-only instance identity records and durable device renames in Main.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deviceIdentitySchema, deviceNameSchema, type DeviceIdentity } from '../contracts/device-identity';
import type { NativeFileCommit } from '../runtime/basic/native-file-commit';

const recordSchema = deviceIdentitySchema.extend({
  schemaVersion: z.literal(1),
  sequence: z.number().int().min(1).max(1000),
});

export class DeviceIdentityStore {
  private sequence = 0;
  private value: DeviceIdentity | null = null;
  private writing = false;
  private failed = false;

  /**
   * Binds the single Main writer to the application's protected identity journal.
   */
  private constructor(
    private readonly native: NativeFileCommit,
    private readonly root: string
  ) {}

  /**
   * Recovers immutable identity history or initializes a legacy installation before MCP admission.
   * @throws When initialized identity is missing, invalid or no longer privately protected.
   */
  static async open(
    native: NativeFileCommit,
    data: string,
    initialized: boolean
  ): Promise<DeviceIdentityStore> {
    const root = join(data, 'device');
    const info = await native.inspect(root);
    if (!info.ok) {
      if (info.nativeCode !== 2 || initialized) {
        throw new Error('设备身份目录缺失或无效');
      }
      const created = await native.createRecovery(root);
      if (!created.ok || !created.privateAcl) {
        throw new Error('无法创建私有设备身份目录');
      }
    }
    const directory = await native.inspect(root);
    if (!directory.ok || !directory.directory || !directory.privateAcl) {
      throw new Error('设备身份目录保护无效');
    }
    const owner = new DeviceIdentityStore(native, root);
    const names = (await readdir(root)).sort();
    if (names.length > 1000 || (initialized && names.length === 0)) {
      throw new Error('设备身份历史缺失或超限');
    }
    for (const name of names) {
      if (name !== `${String(owner.sequence + 1).padStart(4, '0')}.json`) {
        throw new Error('设备身份历史顺序无效');
      }
      const file = await native.inspect(join(root, name));
      if (!file.ok || file.directory || !file.privateAcl || file.links !== 1 || file.size > 2048) {
        throw new Error('设备身份记录保护无效');
      }
      const read = await native.readSnapshot(join(root, name));
      if (!read.ok || !read.privateAcl || read.links !== 1 || read.bytes.length > 2048) {
        throw new Error('设备身份记录无效');
      }
      const record = recordSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes))
      );
      if (
        record.sequence !== owner.sequence + 1 ||
        (owner.value && owner.value.deviceId !== record.deviceId)
      ) {
        throw new Error('设备身份历史改变');
      }
      owner.sequence = record.sequence;
      owner.value = { deviceId: record.deviceId, deviceName: record.deviceName };
    }
    if (!owner.value) {
      const deviceId = randomUUID();
      let name = '';
      try {
        name = hostname();
      } catch {
        /* A finite fallback remains editable by the user. */
      }
      const parsed = deviceNameSchema.safeParse(name);
      await owner.append({
        deviceId,
        deviceName: parsed.success ? parsed.data : `Executor-${deviceId.slice(0, 8)}`,
      });
    }
    return owner;
  }

  /**
   * Returns a detached saved identity; Runtime owns its own immutable startup snapshot.
   */
  read(): DeviceIdentity {
    if (!this.value) {
      throw new Error('设备身份未初始化');
    }
    return { ...this.value };
  }

  /**
   * Commits a validated rename without changing the instance ID or replacing prior evidence.
   */
  async rename(name: string): Promise<void> {
    const deviceName = deviceNameSchema.parse(name);
    const current = this.read();
    if (deviceName !== current.deviceName) {
      await this.append({ ...current, deviceName });
    }
  }

  /**
   * Serializes durable publication and blocks subsequent writes after an unconfirmed outcome.
   */
  private async append(value: DeviceIdentity): Promise<void> {
    const record = recordSchema.parse({ ...value, schemaVersion: 1, sequence: this.sequence + 1 });
    if (this.writing || this.failed) {
      throw new Error('设备身份暂不可写入');
    }
    this.writing = true;
    try {
      const directory = await this.native.inspect(this.root);
      if (!directory.ok || !directory.directory || !directory.privateAcl) {
        throw new Error('设备身份目录保护无效');
      }
      const written = await this.native.writePrivateConfig(
        join(this.root, `${String(record.sequence).padStart(4, '0')}.json`),
        JSON.stringify(record) + '\n'
      );
      if (!written.ok || !written.privateAcl) {
        throw new Error('设备身份写入未获确认');
      }
      this.sequence = record.sequence;
      this.value = { deviceId: record.deviceId, deviceName: record.deviceName };
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.writing = false;
    }
  }
}
