/**
 * @author Codex
 * @description Publishes authoritative settings with project-owned recovery evidence and same-volume native replacement.
 */
import { mkdir, readdir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NativeFileCommit } from '../runtime/basic/native-file-commit';

const operationSchema = z.strictObject({
  id: z.uuid(),
  before: z.string().max(8192).nullable(),
  after: z.string().max(8192),
});

export class SettingsPublication {
  private current: string | null = null;
  private identity = 'absent';
  private failed = false;
  private writing = false;
  readonly path: string;
  private readonly work: string;

  /**
   * Separates settings ownership from Electron userData and derives every temporary name internally.
   */
  constructor(
    private readonly native: NativeFileCommit,
    private readonly projectRoot: string
  ) {
    this.path = join(projectRoot, 'settings.json');
    this.work = join(projectRoot, 'settings-recovery');
  }

  /**
   * Validates the authoritative file and interprets interrupted operations without replaying publication.
   */
  async open(): Promise<string | null> {
    await mkdir(this.projectRoot, { recursive: true });
    const parent = await this.native.inspect(this.projectRoot);
    if (!parent.ok || !parent.directory) {
      throw new Error('正式设置目录无效');
    }
    const created = await this.native.createRecovery(this.work);
    if (!created.ok && created.nativeCode !== 183) {
      throw new Error('无法创建设置工作目录');
    }
    const info = await this.native.inspect(this.work);
    if (!info.ok || !info.directory || !info.privateAcl) {
      throw new Error('设置工作目录保护无效');
    }
    const existing = await this.readFile(this.path, true);
    const marker = await this.readFile(join(this.work, 'initialized.json'), true);
    const identityMarker = await this.readFile(join(this.work, 'device-initialized.json'), true);
    if (
      identityMarker &&
      (identityMarker.text !== '{"initialized":true}' ||
        !existing ||
        JSON.parse(existing.text).identityInitialized !== true)
    ) {
      throw new Error('设备身份初始化标记回退或缺失');
    }
    if (marker && marker.text !== '{"initialized":true}') {
      throw new Error('正式设置初始化标记无效');
    }
    if (marker && !existing) {
      throw new Error('正式设置文件缺失，请检查保留材料');
    }
    this.current = existing?.text ?? null;
    this.identity = existing?.identity ?? 'absent';
    const names = await readdir(this.work);
    if (names.length > 100) {
      throw new Error('未决设置记录超过上限');
    }
    for (const name of names) {
      if (name === 'initialized.json' || name === 'device-initialized.json') {
        continue;
      }
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) {
        throw new Error('未知设置恢复材料');
      }
      const evidence = await this.readFile(join(this.work, name), false);
      const operation = operationSchema.parse(JSON.parse(evidence!.text));
      if (
        `${operation.id}.json` !== name ||
        (this.current !== operation.before && this.current !== operation.after)
      ) {
        throw new Error('设置保存结果无法确认，请检查保留材料');
      }
      await this.checkBackup(operation.id, operation.before);
      await this.cleanup(operation.id);
    }
    if (existing) {
      await this.markInitialized();
    }
    return this.current;
  }

  /**
   * Inspects protected ordinary files through one native read and rejects absent/corrupt evidence.
   */
  private async readFile(
    path: string,
    allowMissing: boolean
  ): Promise<{ text: string; identity: string } | null> {
    const info = await this.native.inspect(path);
    if (allowMissing && !info.ok && info.nativeCode === 2) {
      return null;
    }
    if (!info.ok || info.directory || !info.privateAcl || info.links !== 1 || info.size > 32768) {
      throw new Error('设置文件保护或大小无效');
    }
    const read = await this.native.readSnapshot(path);
    if (
      !read.ok ||
      !read.privateAcl ||
      read.links !== 1 ||
      read.identity !== info.identity ||
      read.bytes.length > 32768
    ) {
      throw new Error('设置文件读取失败');
    }
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(read.bytes), identity: read.identity };
  }

  /**
   * Writes private before/after evidence, then atomically publishes on the destination volume.
   * Unknown outcomes close this writer; the next open reconciles actual bytes rather than retrying the mutation.
   */
  async save(text: string): Promise<void> {
    if (this.failed || this.writing || Buffer.byteLength(text) > 8192) {
      throw new Error('设置暂不可写入');
    }
    this.writing = true;
    const id = randomUUID();
    const directory = join(this.projectRoot, `.octopus-executor-recovery-settings-${id}`);
    try {
      const before = await this.readFile(this.path, true);
      if ((before?.text ?? null) !== this.current || (before?.identity ?? 'absent') !== this.identity) {
        throw new Error('设置已被其他程序修改，请重新打开执行器');
      }
      if (this.current === text) {
        return;
      }
      const evidence = operationSchema.parse({ id, before: this.current, after: text });
      const written = await this.native.writePrivateConfig(
        join(this.work, `${id}.json`),
        JSON.stringify(evidence)
      );
      if (!written.ok || !written.privateAcl) {
        throw new Error('设置变更记录保存失败');
      }
      const staging = await this.native.createRecovery(directory);
      if (!staging.ok || !staging.privateAcl) {
        throw new Error('设置暂存目录创建失败');
      }
      const prepared = await this.native.writePrivateConfig(join(directory, 'next.json'), text);
      if (!prepared.ok || !prepared.privateAcl) {
        throw new Error('设置暂存文件创建失败');
      }
      const parent = await this.native.inspect(this.projectRoot);
      if (!parent.ok || !parent.directory) {
        throw new Error('正式设置目录改变');
      }
      const result = await this.native.commit({
        target: this.path,
        temp: join(directory, 'next.json'),
        backup: join(directory, 'previous.json'),
        targetIdentity: this.identity,
        parentIdentity: parent.identity,
        tempIdentity: prepared.identity,
      });
      if (!result.ok) {
        throw new Error('设置发布结果未获确认，请保留恢复材料');
      }
      await this.checkBackup(id, this.current);
      const actual = await this.readFile(this.path, false);
      if (actual!.text !== text) {
        throw new Error('设置发布后发生变化');
      }
      this.current = text;
      this.identity = actual!.identity;
      await this.markInitialized();
      await this.cleanup(id);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.writing = false;
    }
  }

  /**
   * Preserves an external edit caught between observation and replacement instead of deleting its backup.
   */
  private async checkBackup(id: string, before: string | null): Promise<void> {
    const path = join(this.projectRoot, `.octopus-executor-recovery-settings-${id}`, 'previous.json');
    const info = await this.native.inspect(path);
    if (!info.ok && [2, 3].includes(info.nativeCode)) {
      return;
    }
    const actual = await this.readFile(path, false);
    if (actual!.text !== before) {
      throw new Error('检测到并发设置变更，已保留原始备份');
    }
  }

  /**
   * Prevents deletion of a formal settings file from silently reimporting stale numbered preferences.
   */
  private async markInitialized(): Promise<void> {
    if (this.current && JSON.parse(this.current).identityInitialized === true) {
      await this.ensureMarker('device-initialized.json');
    }
    await this.ensureMarker('initialized.json');
  }

  /**
   * Retains monotonic initialization evidence independently of replaceable user preferences.
   */
  private async ensureMarker(name: string): Promise<void> {
    const path = join(this.work, name);
    const prior = await this.readFile(path, true);
    if (prior) {
      if (prior.text !== '{"initialized":true}') {
        throw new Error('正式设置初始化标记无效');
      }
      return;
    }
    const marker = await this.native.writePrivateConfig(path, '{"initialized":true}');
    if (!marker.ok || !marker.privateAcl) {
      throw new Error('正式设置初始化标记保存失败');
    }
  }

  /**
   * Removes only the two known same-volume files and this operation's private evidence; unknown entries remain.
   */
  private async cleanup(id: string): Promise<void> {
    const directory = join(this.projectRoot, `.octopus-executor-recovery-settings-${id}`);
    const info = await this.native.inspect(directory);
    if (info.ok) {
      if (!info.directory || !info.privateAcl) {
        throw new Error('设置暂存目录不再受保护');
      }
      for (const name of ['next.json', 'previous.json']) {
        const path = join(directory, name);
        const file = await this.readFile(path, true);
        if (file) {
          await unlink(path);
        }
      }
      await rmdir(directory);
    } else if (info.nativeCode !== 2) {
      throw new Error('无法确认设置暂存目录');
    }
    await this.readFile(join(this.work, `${id}.json`), false);
    await unlink(join(this.work, `${id}.json`));
  }
}
