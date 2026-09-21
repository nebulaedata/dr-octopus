/**
 * @author Claude Code
 * @description 注册 Workspace 生命周期事件，向 Pi 声明 Workspace 作用域的 Skills 目录
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * @description 注册 resources_discover 处理器，让 Workspace 内的 Skills 不经 Project Trust 即可随 Session 加载。
 *
 * Workspace Skills 固定在 `<cwd>/.dr-octopus/skills`；目录存在时追加为 skillPaths，
 * 不存在时返回空结果，避免 Pi 为每个无 Skills 的 Workspace 记录诊断噪音。
 * 该通道只追加 Skill 资源路径，不引入 Project 级扩展代码执行面（见 ADR-0014）。
 *
 * @param pi 当前 Pi Extension API。
 */
export function registerWorkspaceEvents(pi: ExtensionAPI): void {
  pi.on('resources_discover', async (event) => {
    const skillsDir = join(event.cwd, CONFIG_DIR_NAME, 'skills');
    if (await isDirectory(skillsDir)) {
      return { skillPaths: [skillsDir] };
    }
    return {};
  });
}

/**
 * @description 判断路径是否为已存在的目录；任何文件系统错误都按不存在处理。
 *
 * @param path 待检查的绝对路径。
 * @returns 路径存在且为目录时返回 true。
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
