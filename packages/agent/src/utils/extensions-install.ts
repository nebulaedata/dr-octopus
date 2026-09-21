/**
 * @author Codex
 * @description 安装并持久化 Dr.Octopus Agent 默认使用的 Pi 扩展。
 * @link https://pi.dev/packages
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DefaultPackageManager, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { ensureContextModeMcpConfigured, isContextModeSource } from './context-mode-mcp-config.js';
import type { PackageManager } from '@earendil-works/pi-coding-agent';

/**
 * 默认安装的 Pi 扩展列表
 *
 * 绑定版本号：当需要锁定版本时，source 中包含精确语义版本号；否则使用最新可用版本。
 * 例如：
 * - npm:pi-subagents@0.68.0  // 锁定版本
 * - npm:@narumitw/pi-goal@0.54.3 // 锁定前端与服务端适配的状态和工具契约
 *
 * 何时需要锁定版本：
 * - 应用层(server/web...)适配依赖的 Extension API ，如果发生重大变更，可能导致适配不兼容。
 * - 需要确保在不同环境中使用相同的扩展版本，以避免行为差异。
 */
export const EXTENSION_SOURCES = [
  'npm:@juicesharp/rpiv-ask-user-question@2.7.1',
  'npm:pi-subagents@0.68.0',
  'npm:@narumitw/pi-plan-mode@0.55.3',
  'npm:@narumitw/pi-goal@0.54.3',
  'npm:pi-mcp-adapter@2.34.0',
  'npm:context-mode@1.0.169',
  'npm:pi-web-access',
];

/**
 * 控制默认 Pi 扩展的安装交互。
 */
export interface InstallExtensionsOptions {
  /**
   * 是否跳过确认并安装全部扩展。
   */
  force?: boolean;
  /**
   * 是否静默安装全部扩展，不显示确认、进度或完成信息。
   */
  silent?: boolean;
  /**
   * 本次需要交互处理的扩展来源；默认处理全部内置来源。
   */
  sources?: readonly string[];
}

type ExtensionPackageManager = Pick<PackageManager, 'installAndPersist' | 'listConfiguredPackages'>;

type ExtensionSettingsManager = Pick<SettingsManager, 'flush'>;

/**
 * 描述一次默认扩展环境检查所需的可替换依赖。
 */
export interface EnsureExtensionsOptions {
  /**
   * 用于解析 Pi 配置的工作目录。
   */
  cwd?: string;
  /**
   * Pi Agent 用户级目录。
   */
  agentDir?: string;
  /**
   * 需要保证可用的扩展来源。
   */
  sources?: readonly string[];
  /**
   * 测试或宿主注入的 Pi 包管理器。
   */
  packageManager?: ExtensionPackageManager;
  /**
   * 与注入包管理器配套的设置持久化器。
   */
  settingsManager?: ExtensionSettingsManager;
}

/**
 * 记录单个扩展安装失败的稳定结果。
 */
export interface ExtensionInstallFailure {
  /**
   * 未能安装的扩展来源。
   */
  source: string;
  /**
   * 包管理器返回的原始失败原因。
   */
  error: unknown;
  /**
   * 失败是否符合离线或网络不可达特征。
   */
  networkUnavailable: boolean;
}

/**
 * 汇总启动前默认扩展环境的检查与修复结果。
 */
export interface EnsureExtensionsResult {
  /**
   * 检查前已经就绪的扩展。
   */
  alreadyInstalled: string[];
  /**
   * 本次成功补装并持久化的扩展。
   */
  installed: string[];
  /**
   * 启动时仍不可用的扩展及原因。
   */
  failures: ExtensionInstallFailure[];
}

/**
 * 描述默认扩展在当前 Pi 用户级环境中的安装状态。
 */
export interface ExtensionInstallationStatus {
  /**
   * 已配置且安装目录存在的扩展。
   */
  installed: string[];
  /**
   * 尚未安装或安装目录已经丢失的扩展。
   */
  missing: string[];
}

type RegistryFetch = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, 'ok'>>;

let silentNpmOperationTail = Promise.resolve();

/**
 * 控制 npm Registry 可用性探测。
 */
export interface ExtensionRegistryCheckOptions {
  /**
   * 覆盖 npm Registry 地址；默认读取 NPM_CONFIG_REGISTRY 后回退到官方 Registry。
   */
  registryUrl?: string;
  /**
   * Registry 探测超时时间。
   */
  timeoutMs?: number;
  /**
   * 测试注入的 fetch 实现。
   */
  fetchImpl?: RegistryFetch;
}

/**
 * 只读取 Pi 包配置与安装目录，判断默认扩展是否需要补装。
 *
 * @param options 工作目录、扩展来源及可替换的 Pi 管理依赖。
 * @returns 已安装与缺失的扩展集合。
 */
export function getExtensionInstallationStatus(
  options: EnsureExtensionsOptions = {}
): ExtensionInstallationStatus {
  const sources = [...(options.sources ?? EXTENSION_SOURCES)];
  const dependencies = createExtensionDependencies(options);
  return classifyExtensionInstallation(sources, dependencies.packageManager);
}

/**
 * 在进入交互安装前快速探测 npm Registry，避免离线时等待逐项安装失败。
 *
 * @param options Registry 地址、超时与可替换 fetch 实现。
 * @returns Registry 是否在超时内返回成功响应。
 */
export async function isExtensionRegistryAvailable(
  options: ExtensionRegistryCheckOptions = {}
): Promise<boolean> {
  const registryUrl = options.registryUrl ?? process.env.NPM_CONFIG_REGISTRY ?? 'https://registry.npmjs.org';
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const pingUrl = new URL('-/ping', `${registryUrl.replace(/\/+$/, '')}/`);
    const response = await fetchImpl(pingUrl, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 检查默认扩展并只安装缺失项，使正常在线启动具备完整扩展环境。
 * 单个安装失败会被收集而不是中断后续检查，交由宿主决定降级策略。
 *
 * @param options 工作目录、扩展来源及可替换的 Pi 管理依赖。
 * @returns 已有、已补装及仍失败的扩展集合。
 */
export async function ensureExtensionsInstalled(
  options: EnsureExtensionsOptions = {}
): Promise<EnsureExtensionsResult> {
  const sources = [...(options.sources ?? EXTENSION_SOURCES)];
  const dependencies = createExtensionDependencies(options);
  const status = classifyExtensionInstallation(sources, dependencies.packageManager);
  const installed: string[] = [];
  const failures: ExtensionInstallFailure[] = [];

  for (const source of status.installed.filter(isContextModeSource)) {
    try {
      await ensureContextModeMcpConfigured(options.agentDir);
    } catch (error) {
      failures.push({ source, error, networkUnavailable: false });
    }
  }

  for (const source of status.missing) {
    try {
      await runWithSilentNpmOutput(() => dependencies.packageManager.installAndPersist(source));
      await dependencies.settingsManager.flush();
      if (isContextModeSource(source)) {
        await ensureContextModeMcpConfigured(options.agentDir);
      }
      installed.push(source);
    } catch (error) {
      failures.push({
        source,
        error,
        networkUnavailable: isNetworkUnavailableError(error),
      });
    }
  }

  return { alreadyInstalled: status.installed, installed, failures };
}

/**
 * 安装扩展并将来源持久化到 Agent 的用户级 settings.json。
 * 重复执行会由 Pi 包管理器复用同一安装目录和配置项。
 *
 * @param options 安装行为选项。
 * @returns 扩展全部安装且配置刷新完成后结束的 Promise。
 */
export async function installExtensions(options: InstallExtensionsOptions = {}): Promise<void> {
  const ui = options.silent ? undefined : await import('@clack/prompts');
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(process.cwd(), agentDir);
  const packageManager = new DefaultPackageManager({
    cwd: process.cwd(),
    agentDir,
    settingsManager,
  });

  if (!options.silent) {
    console.log('\n');
    ui?.intro('安装 Dr.Octopus Pi 扩展');
    ui?.log.info(`Pi Agent 全局目录: ${agentDir}`);
  }

  for (const source of options.sources ?? EXTENSION_SOURCES) {
    if (!options.force && !options.silent) {
      const shouldInstall = await ui!.confirm({
        message: `是否安装 ${source}？`,
        active: 'yes',
        inactive: 'no',
        initialValue: true,
      });

      if (ui!.isCancel(shouldInstall)) {
        await settingsManager.flush();
        ui!.cancel('已取消后续扩展安装。');
        return;
      }

      if (!shouldInstall) {
        ui!.log.warn(`已跳过: ${source}`);
        continue;
      }
    }

    const installSpinner = options.silent ? undefined : ui?.spinner();
    installSpinner?.start(`正在安装: ${source}`);

    try {
      await runWithSilentNpmOutput(() => packageManager.installAndPersist(source));
      if (isContextModeSource(source)) {
        await ensureContextModeMcpConfigured(agentDir);
      }
      installSpinner?.stop(`已安装: ${source}`);
    } catch (error) {
      installSpinner?.error(`安装失败: ${source}`);
      throw error;
    }
  }

  await settingsManager.flush();
  if (!options.silent) {
    ui?.outro('Pi 扩展处理完成。');
  }
}

/**
 * 在 Pi 包管理器安装期间抑制其继承到宿主控制台的 npm 输出。
 * 串行修改进程级环境，避免并发安装提前恢复或遗留日志级别。
 *
 * @param operation 需要静默执行的包管理操作。
 * @returns 操作的原始结果。
 */
async function runWithSilentNpmOutput<T>(operation: () => Promise<T>): Promise<T> {
  const previousOperation = silentNpmOperationTail;
  let releaseOperation: () => void = () => undefined;
  silentNpmOperationTail = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });
  await previousOperation;

  const previousNpmLogLevel = process.env.NPM_CONFIG_LOGLEVEL;
  process.env.NPM_CONFIG_LOGLEVEL = 'silent';

  try {
    return await operation();
  } finally {
    if (previousNpmLogLevel === undefined) {
      delete process.env.NPM_CONFIG_LOGLEVEL;
    } else {
      process.env.NPM_CONFIG_LOGLEVEL = previousNpmLogLevel;
    }
    releaseOperation();
  }
}

/**
 * 根据 Pi 已解析的包记录划分已安装与缺失来源。
 *
 * @param sources 需要检查的扩展来源。
 * @param packageManager 提供用户级包安装记录的 Pi 包管理器。
 * @returns 保持输入顺序的扩展安装状态。
 */
function classifyExtensionInstallation(
  sources: readonly string[],
  packageManager: ExtensionPackageManager
): ExtensionInstallationStatus {
  const configuredPackages = packageManager.listConfiguredPackages();
  const installed = sources.filter((source) =>
    configuredPackages.some((configured) => isExpectedExtensionInstalled(source, configured))
  );
  const installedSources = new Set(installed);
  const missing = sources.filter((source) => !installedSources.has(source));
  return { installed, missing };
}

/**
 * 同时验证 Pi 配置 source、安装目录和磁盘包版本，防止配置与实际内容错位。
 *
 * @param expectedSource 项目要求的扩展 source。
 * @param configured Pi 已解析的包记录。
 * @returns 配置和磁盘安装是否都满足项目要求。
 */
function isExpectedExtensionInstalled(
  expectedSource: string,
  configured: ReturnType<ExtensionPackageManager['listConfiguredPackages']>[number]
): boolean {
  if (
    configured.scope !== 'user' ||
    configured.source !== expectedSource ||
    configured.installedPath === undefined
  ) {
    return false;
  }

  const expectedVersion = getExactNpmVersion(expectedSource);
  if (expectedVersion === undefined) {
    return true;
  }

  try {
    const manifest = JSON.parse(readFileSync(join(configured.installedPath, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return manifest.version === expectedVersion;
  } catch {
    return false;
  }
}

/**
 * 从 npm source 中提取项目可锁定的精确语义版本。
 *
 * @param source Pi npm 包来源。
 * @returns 精确版本；非 npm source、无版本或版本范围返回 undefined。
 */
function getExactNpmVersion(source: string): string | undefined {
  if (!source.startsWith('npm:')) {
    return undefined;
  }

  const specifier = source.slice('npm:'.length);
  const match = specifier.match(/^(@?[^@]+(?:\/[^@]+)?)@(.+)$/);
  const version = match?.[2];
  return version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ? version
    : undefined;
}

/**
 * 创建生产环境使用的 Pi 包管理与设置持久化依赖。
 *
 * @param options 可选的宿主注入依赖与目录。
 * @returns 保证成对使用的包管理器和设置管理器。
 */
function createExtensionDependencies(options: EnsureExtensionsOptions): {
  packageManager: ExtensionPackageManager;
  settingsManager: ExtensionSettingsManager;
} {
  if (options.packageManager && options.settingsManager) {
    return {
      packageManager: options.packageManager,
      settingsManager: options.settingsManager,
    };
  }

  if (options.packageManager || options.settingsManager) {
    throw new Error('packageManager and settingsManager must be provided together');
  }

  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  return {
    packageManager: new DefaultPackageManager({ cwd, agentDir, settingsManager }),
    settingsManager,
  };
}

/**
 * 判断包管理器错误是否表明注册表或网络当前不可达。
 *
 * @param error 安装扩展时捕获的未知错误。
 * @returns 错误是否应以离线降级方式提示。
 */
function isNetworkUnavailableError(error: unknown): boolean {
  const details = collectErrorDetails(error).toLowerCase();
  return /\b(eai_again|econnrefused|econnreset|enetunreach|ehostunreach|enotfound|etimedout)\b|fetch failed|network|offline|getaddrinfo/.test(
    details
  );
}

/**
 * 提取 Error 及带 code/cause 的基础设施错误信息供分类使用。
 *
 * @param error 任意捕获值。
 * @returns 不包含结构化对象序列化的错误摘要。
 */
function collectErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const errorWithMetadata = error as Error & { code?: unknown; cause?: unknown };
  const cause = errorWithMetadata.cause;
  const causeDetails = cause === undefined || cause === error ? '' : collectErrorDetails(cause);
  return [error.message, errorWithMetadata.code, causeDetails].filter(Boolean).join(' ');
}
