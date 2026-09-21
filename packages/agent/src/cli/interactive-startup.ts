/**
 * @author Codex
 * @description Owns interactive CLI installation prompts, keeping terminal dependencies out of RPC startup.
 */
import { installBundledInfra, isBundledInfraInstalled } from '../infra/index.js';
import { runInteractiveInstall } from './terminal-ui.js';
import { isOfflineRequested } from './parse-args.js';
import {
  getExtensionInstallationStatus,
  installExtensions,
  isExtensionRegistryAvailable,
} from '../utils/extensions-install.js';
import {
  ensureContextModeMcpConfigured,
  isContextModeMcpConfigured,
  isContextModeSource,
} from '../utils/context-mode-mcp-config.js';

/**
 * Offers installation and repair only after the caller has selected a real interactive TUI launch.
 */
export async function prepareInteractiveStartup(piArgs: string[]): Promise<void> {
  // Offline Install Infra: if not installed
  const isInstalled = await isBundledInfraInstalled();
  if (!isInstalled) {
    await runInteractiveInstall(installBundledInfra, {
      cancelText: '已取消内置工具安装。',
      confirmText: '检测到内置工具尚未安装，是否现在安装？',
      errorText: '内置工具离线安装失败',
      progressText: '正在离线安装内置工具…',
      successText: '内置工具离线安装完成',
      warnText: '已跳过内置工具安装。',
    });
  }

  // Online Install Extensions: install missing Pi Extensions interactively when network access is available

  const extensionStatus = getExtensionInstallationStatus();
  if (extensionStatus.missing.length > 0) {
    if (isOfflineRequested(piArgs)) {
      process.stderr.write('当前为离线模式，已跳过缺失 Pi 扩展的安装。\n');
    } else if (!(await isExtensionRegistryAvailable())) {
      process.stderr.write('npm Registry 当前不可用，已跳过缺失 Pi 扩展的安装。\n');
    } else {
      try {
        await installExtensions({ sources: extensionStatus.missing });
      } catch {
        process.stderr.write('Pi 扩展安装未完成，将继续启动；可稍后运行 `pnpm install:extensions`。\n');
      }
    }
  }

  // Repair context-mode MCP configuration interactively only for a real Agent TUI launch.
  const currentExtensionStatus = getExtensionInstallationStatus();
  if (currentExtensionStatus.installed.some(isContextModeSource) && !(await isContextModeMcpConfigured())) {
    try {
      await runInteractiveInstall(() => ensureContextModeMcpConfigured(), {
        cancelText: '已取消 context-mode MCP 配置。',
        confirmText: '检测到 context-mode MCP 配置缺失或不完整，是否现在配置？',
        errorText: 'context-mode MCP 配置失败',
        progressText: '正在配置 context-mode MCP…',
        successText: 'context-mode MCP 配置完成',
        warnText: '已跳过 context-mode MCP 配置。',
      });
    } catch {
      process.stderr.write('context-mode MCP 配置未完成，可稍后重新启动 Agent TUI。\n');
    }
  }
}
