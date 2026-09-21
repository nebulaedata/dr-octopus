/**
 * @author Codex
 * @description 在 Pi 读取 cwd 和配置前应用 Octopus CLI 的环境变量与默认值
 */
import process from 'node:process';
import { agentEnvironmentDefaults } from '../utils/environment.js';
import type { WorkspaceDescriptor } from '../extensions/workspace/definitions/types.js';

/**
 * @description 默认允许 Pi 启动时的网络操作；保留用户显式设置的 PI_OFFLINE
 */
export function prepareOfflineEnv(): void {
  process.env.PI_OFFLINE ??= agentEnvironmentDefaults.PI_OFFLINE;
}

/**
 * @description 强制 WSL 使用 UTF-8 输出，避免 Windows 本地化诊断被 Pi 按 UTF-8 解码后产生乱码
 * @param platform 当前运行平台，允许测试覆盖
 * @param env 要配置并传递给 Agent 子进程的环境变量
 */
export function prepareSubprocessEncodingEnv(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (platform === 'win32') {
    env.WSL_UTF8 ??= '1';
  }
}

/**
 * @description 设置当前工作目录为指定的 Workspace 的 cwd
 * @param workspace 要设置的 Workspace 对象
 */
export function prepareWorkspaceEnv(workspace: WorkspaceDescriptor): void {
  process.chdir(workspace.cwd);
}
