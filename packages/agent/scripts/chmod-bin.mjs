/**
 * @author Codex
 * @description 确保构建后的 Octopus CLI 入口具有可执行权限
 */
import { chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await chmod(resolve(agentDir, 'dist', 'bin', 'octopus.js'), 0o755);
