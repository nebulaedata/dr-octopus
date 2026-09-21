/**
 * @author Codex
 * @description 离线安装 fd 和 ripgrep 工具并生成 Agent 环境变量
 */

import { chmod, cp, mkdir } from 'node:fs/promises';
import { delimiter, dirname, join, resolve, sep } from 'node:path';

import { verifyFileIntegrity } from './integrity.js';
import { readInfraManifest } from './manifest.js';

import type { InstallInfraOptions, InstalledInfra } from './types.js';

/**
 * 确保 manifest 中的相对路径不会逃逸指定根目录。
 *
 * @param root 允许访问的根目录
 * @param relativePath manifest 相对路径
 * @returns 已验证的绝对路径
 */
function resolveInside(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`Infra path escapes its root: ${relativePath}`);
  }
  return absolutePath;
}

/**
 * 获取当前运行平台对应的资源，并在平台不受支持时给出明确错误。
 *
 * @param options 发布目录、安装目录与可选的平台覆盖
 * @returns 当前平台必须具备的离线资源
 */
async function resolvePlatformResources(options: InstallInfraOptions) {
  const manifest = await readInfraManifest(options.infraDir);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const resources = manifest.resources.filter(
    (resource) => resource.platform === platform && resource.arch === arch
  );

  if (resources.length === 0) {
    throw new Error(`No Agent infra resources for ${platform}-${arch}`);
  }

  return { platform, resources };
}

/**
 * 检查目标目录中的所有平台工具是否存在且内容与发布清单一致。
 *
 * @param options 发布目录、安装目录与可选的平台覆盖
 * @returns 所有目标文件均通过完整性验证时返回 true
 */
export async function isInfraInstalled(options: InstallInfraOptions): Promise<boolean> {
  const { resources } = await resolvePlatformResources(options);

  try {
    await Promise.all(
      resources.map((resource) =>
        verifyFileIntegrity(resolveInside(options.agentDir, resource.target), resource.sha256)
      )
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 安装当前平台使用的 fd 和 ripgrep。
 *
 * @returns 工具安装目录
 */
async function installTools(options: InstallInfraOptions): Promise<string> {
  const { platform, resources } = await resolvePlatformResources(options);

  for (const resource of resources) {
    const source = resolveInside(options.infraDir, resource.file);
    const target = resolveInside(options.agentDir, resource.target);
    await verifyFileIntegrity(source, resource.sha256);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { force: true });
    if (resource.executable && platform !== 'win32') {
      await chmod(target, 0o755);
    }
  }

  return join(options.agentDir, 'bin');
}

/**
 * 完成 Agent 离线基础设施安装。
 *
 * @param options 发布目录、Agent 目录和工作区配置
 * @returns 可用于启动 Agent Worker 的工具路径和环境变量
 */
export async function installInfra(options: InstallInfraOptions): Promise<InstalledInfra> {
  const binDir = join(options.agentDir, 'bin');
  if (options.force || !(await isInfraInstalled(options))) {
    await installTools(options);
  }
  return {
    binDir,
    environment: {
      PATH: [binDir, process.env.PATH].filter(Boolean).join(delimiter),
    },
  };
}
