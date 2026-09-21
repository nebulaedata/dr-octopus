/**
 * @author Codex
 * @description Owns Agent environment configuration without depending on a Host or loading the Pi runtime.
 */
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { createEnvironmentStore, EnvironmentError } from '@octopus/env-loader';
import type { EnvironmentValues } from '@octopus/env-loader';

export const agentEnvironmentDefaults: EnvironmentValues = Object.freeze({ PI_OFFLINE: '0' });

/**
 * Prevents persisted settings from redirecting their own location or impersonating internal process roles.
 */
export function validateAgentEnvironment(values: EnvironmentValues): void {
  for (const key of Object.keys(values)) {
    if (key !== key.toUpperCase()) {
      throw new EnvironmentError('ENV_INVALID', 'Agent variable names must use uppercase letters.');
    }
    if (/^(SERVER_|DR_OCTOPUS_|OCTOPUS_|NODE_|LD_|DYLD_)/i.test(key) || key === 'PI_CODING_AGENT_DIR') {
      throw new EnvironmentError('ENV_INVALID', `${key} is reserved for process startup.`);
    }
  }
  if (
    values.PI_OFFLINE !== undefined &&
    !['', '0', '1', 'true', 'false', 'yes', 'no'].includes(values.PI_OFFLINE.trim().toLowerCase())
  ) {
    throw new EnvironmentError('ENV_INVALID', 'PI_OFFLINE must be a boolean flag.');
  }
}

/**
 * Resolves the bootstrap directory before reading any persistent environment values.
 */
export function resolveAgentEnvironmentDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const directory =
    environment.DR_OCTOPUS_CODING_AGENT_DIR?.trim() || join(homedir(), '.dr-octopus', 'agent');
  if (!isAbsolute(directory) || resolve(directory) === parse(resolve(directory)).root) {
    throw new EnvironmentError(
      'ENV_INVALID',
      'Agent directory must be absolute and cannot be a filesystem root.'
    );
  }
  return resolve(directory);
}

/**
 * Opens a user-scoped Agent store with host-supplied bootstrap paths and environment overrides.
 */
export function createAgentEnvironmentStore(
  directory = resolveAgentEnvironmentDirectory(),
  environment: NodeJS.ProcessEnv = process.env
) {
  return createEnvironmentStore({
    path: join(directory, 'environment.json'),
    environment,
    defaults: agentEnvironmentDefaults,
    validate: validateAgentEnvironment,
  });
}

/**
 * Applies Agent values only inside its dedicated process, before importing Pi and extension modules.
 */
export function initializeAgentEnvironment(): void {
  const snapshot = createAgentEnvironmentStore().load();
  for (const key of new Set([...Object.keys(snapshot.persisted), ...Object.keys(agentEnvironmentDefaults)])) {
    process.env[key] = snapshot.values[key];
  }
}
