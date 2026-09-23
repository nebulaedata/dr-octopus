/**
 * @author Codex
 * @description Owns every persistent filesystem path and directory environment contract used by Octopus Server.
 */

import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';

export const SERVER_DATA_DIR_ENV = 'SERVER_DATA_DIR';
export const AGENT_DIR_ENV = 'DR_OCTOPUS_CODING_AGENT_DIR';

export interface ServerPaths {
  dataDir: string;
  databasePath: string;
  attachmentsRoot: string;
  backupsRoot: string;
  stateRoot: string;
  logsRoot: string;
}

/**
 * Resolves every Server-owned path from one independently configurable data directory.
 *
 * @param env Environment mapping used by the Server process.
 * @param homeDirectory User home used by defaults and deterministic tests.
 * @returns Immutable absolute Server storage paths.
 * @throws When SERVER_DATA_DIR is relative or resolves to a filesystem root.
 */
export function resolveServerPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir()
): ServerPaths {
  const dataDir = resolveSafeDirectory(
    env[SERVER_DATA_DIR_ENV],
    join(homeDirectory, CONFIG_DIR_NAME, 'server'),
    SERVER_DATA_DIR_ENV
  );
  const attachmentsRoot = join(dataDir, 'attachments');
  return Object.freeze({
    dataDir,
    databasePath: join(dataDir, 'octopus.db'),
    attachmentsRoot,
    backupsRoot: join(dataDir, 'backups'),
    stateRoot: join(dataDir, 'state'),
    logsRoot: join(dataDir, 'logs'),
  });
}

/**
 * Resolves the Pi Agent directory as a Host dependency without introducing Server paths into Agent code.
 *
 * @param env Environment mapping used by the Server process.
 * @param homeDirectory User home used by defaults and deterministic tests.
 * @returns Absolute Pi Agent directory matching Pi's branded default contract.
 * @throws When DR_OCTOPUS_CODING_AGENT_DIR is relative or resolves to a filesystem root.
 */
export function resolveAgentDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir()
): string {
  return resolveSafeDirectory(
    env[AGENT_DIR_ENV],
    join(homeDirectory, CONFIG_DIR_NAME, 'agent'),
    AGENT_DIR_ENV
  );
}

/**
 * Validates an optional directory override and applies its absolute default.
 *
 * @param configured Raw optional environment value.
 * @param fallback Absolute default directory.
 * @param environmentName Name used by validation diagnostics.
 * @returns Normalized absolute non-root directory.
 */
function resolveSafeDirectory(
  configured: string | undefined,
  fallback: string,
  environmentName: string
): string {
  const candidate = configured?.trim() || fallback;
  if (!isAbsolute(candidate)) {
    throw new Error(`${environmentName} must be an absolute path.`);
  }
  const normalized = resolve(candidate);
  if (normalized === parse(normalized).root) {
    throw new Error(`${environmentName} must not resolve to a filesystem root.`);
  }
  return normalized;
}
