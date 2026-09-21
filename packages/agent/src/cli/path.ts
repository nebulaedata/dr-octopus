/**
 * @author Claude Code
 * @description 解析 Octopus CLI 二进制入口路径
 */

import { fileURLToPath } from 'node:url';

/**
 * 返回当前包对应的 Octopus CLI 入口文件绝对路径。
 *
 * 在 monorepo 中解析到 `packages/agent/dist/bin/octopus.js`；
 * 发布场景下解析到 `node_modules/@octopus/agent/dist/bin/octopus.js`。
 * 调用方需保证 `@octopus/agent` 已完成构建。
 *
 * @returns 可直接 spawn 的 CLI JS 文件路径
 */
export function resolveOctopusCliPath(): string {
  return fileURLToPath(new URL('../bin/octopus.js', import.meta.url));
}
