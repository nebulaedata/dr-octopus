/**
 * @author Codex
 * @description Reads and atomically edits permission overlays with inherited previews and optimistic concurrency.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { PermissionConfigSchema } from '@octopus/shared/protocol';
import { tryAcquireProcessLock } from '../../../lib/daemon-platform/singleton-lease.js';
import { loadDefaultPermissionConfiguration } from './default-configuration.js';
import {
  PermissionConfigurationError,
  parsePermissionFile,
  readPermissionFile,
} from './configuration-files.js';
import { mergePermissionConfiguration } from '../services/configuration.js';
import type { PermissionSettingsSnapshot, PermissionSettingsUpdate } from '@octopus/shared/protocol';

export class PermissionConfigurationStore {
  /**
   * Fix locations at the host boundary; workspace paths must already be resolved by the host.
   */
  constructor(
    private readonly agentDir: string,
    private readonly configDirName = CONFIG_DIR_NAME
  ) {}

  /**
   * Include malformed raw JSON for repair while withholding an invalid effective preview.
   */
  get(cwd?: string): PermissionSettingsSnapshot {
    const globalPath = join(this.agentDir, 'permission-system.json');
    const path = cwd === undefined ? globalPath : join(cwd, this.configDirName, 'permission-system.json');
    const file = readPermissionFile(path);
    const diagnostics: PermissionSettingsSnapshot['diagnostics'] = [];
    let inherited: PermissionSettingsSnapshot['inherited'] = loadDefaultPermissionConfiguration();
    let inheritedRevision = JSON.stringify(inherited);
    if (cwd !== undefined) {
      const global = readPermissionFile(globalPath);
      inheritedRevision += global.revision;
      try {
        inherited = mergePermissionConfiguration(inherited, parsePermissionFile(global.raw, globalPath));
      } catch (error) {
        inherited = null;
        diagnostics.push({ path: globalPath, message: (error as Error).message });
      }
    }
    let overrides: PermissionSettingsSnapshot['overrides'] = null;
    try {
      overrides = parsePermissionFile(file.raw, path);
    } catch (error) {
      diagnostics.push({ path, message: (error as Error).message });
    }
    return {
      path,
      raw: file.raw,
      revision: createHash('sha256')
        .update(JSON.stringify([path, file.revision, inheritedRevision]))
        .digest('hex'),
      overrides,
      inherited,
      effective: inherited && overrides ? mergePermissionConfiguration(inherited, overrides) : null,
      diagnostics,
    };
  }

  /**
   * Save only this layer under an OS lock; a changed file or inherited layer requires a fresh preview.
   */
  async update(input: PermissionSettingsUpdate, cwd?: string): Promise<PermissionSettingsSnapshot> {
    const parsed = PermissionConfigSchema.safeParse(input.config);
    if (!parsed.success) {
      throw new PermissionConfigurationError('PERMISSION_CONFIG_INVALID', '权限配置格式无效');
    }
    const initial = this.get(cwd);
    const directory = dirname(initial.path);
    mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink()) {
      throw new PermissionConfigurationError('PERMISSION_CONFIG_INVALID', '权限配置目录不能是符号链接');
    }
    const lock = await tryAcquireProcessLock(`${initial.path}.lock`);
    if (!lock) {
      throw new PermissionConfigurationError('PERMISSION_CONFIG_BUSY', '权限配置正在保存，请稍后重试');
    }
    const temporary = join(directory, `.permission-${randomUUID()}.tmp`);
    try {
      const current = this.get(cwd);
      if (current.revision !== input.revision) {
        throw new PermissionConfigurationError(
          'PERMISSION_CONFIG_CONFLICT',
          '权限配置已改变，请刷新后重新编辑'
        );
      }
      if (!current.inherited) {
        throw new PermissionConfigurationError('PERMISSION_CONFIG_INVALID', '请先修复全局权限配置');
      }
      const raw = `${JSON.stringify({ ...parsed.data, version: 2 }, null, 2)}\n`;
      if (Buffer.byteLength(raw) > 1024 * 1024) {
        throw new PermissionConfigurationError('PERMISSION_CONFIG_INVALID', '权限配置不能超过 1 MiB');
      }
      writeFileSync(temporary, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      renameSync(temporary, current.path);
      return this.get(cwd);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        // A failed temporary-file cleanup must not replace the original save outcome.
      } finally {
        lock.release();
      }
    }
  }
}
