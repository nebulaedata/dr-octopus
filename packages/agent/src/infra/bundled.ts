/**
 * @author Codex
 * @description 定位随 Agent 包发布的离线资源，并安装到产品数据目录
 */
import { access } from 'node:fs/promises';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installInfra, isInfraInstalled } from './installer.js';
import type { InstalledInfra } from './types.js';

/**
 * 控制内置基础设施的安装行为。
 */
export interface InstallBundledInfraOptions {
  /**
   * 即使完整性检查通过，也重新复制内置工具。
   */
  force?: boolean;
}

/**
 * 查找源码运行或构建发布场景下的 infra 目录。
 *
 * @returns 包含有效 manifest 的 infra 绝对路径
 * @throws 当前包未携带离线资源时抛出异常
 */
async function resolveBundledInfraDir(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDir, '..', 'assets', 'infra'), resolve(moduleDir, '..', '..', 'infra')];

  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'manifest.json'));
      return candidate;
    } catch {
      // 继续检查源码与构建产物的另一个标准位置。
    }
  }

  throw new Error('Bundled Agent infra manifest was not found');
}

/**
 * 将当前平台所需的离线工具安装到 Agent 数据目录。
 *
 * @param options 强制重装等安装行为。
 * @returns 工具目录及应合并到当前进程的环境变量
 */
export async function installBundledInfra(options: InstallBundledInfraOptions = {}): Promise<InstalledInfra> {
  const agentDir = getAgentDir();
  const infraDir = await resolveBundledInfraDir();
  return installInfra({
    agentDir,
    infraDir,
    force: options.force,
  });
}

/**
 * 检查当前平台随包发布的工具是否已经完整安装。
 *
 * @returns 所有目标工具存在且校验通过时返回 true
 */
export async function isBundledInfraInstalled(): Promise<boolean> {
  const agentDir = getAgentDir();
  const infraDir = await resolveBundledInfraDir();
  return isInfraInstalled({ agentDir, infraDir });
}
