/**
 * @author Codex
 * @description Resolve product-global memory data independently of Agent config and Workspace paths.
 */
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
/**
 * Resolve a trusted optional product root without creating files.
 */
export function resolveMemoryPaths(dataRoot = join(homedir(), CONFIG_DIR_NAME)) {
  if (!isAbsolute(dataRoot)) {
    throw new Error('Memory dataRoot must be absolute');
  }
  const directory = join(dataRoot, 'memory');
  return { directory, databasePath: join(directory, 'memory.db') };
}
