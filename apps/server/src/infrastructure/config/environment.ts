/**
 * @author Codex
 * @description Defines Server-owned environment defaults and validates its persistent configuration independently of process overrides.
 */
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { createEnvironmentStore, EnvironmentError } from '@octopus/env-loader';
import {
  resolveAttachmentLimitBytes,
  resolveCorsOrigins,
  resolveHttpBodyLimitBytes,
  resolveMaxActiveRuntimes,
  resolveMaxActiveRuntimesPerWorkspace,
  resolveServerEnvironment,
  resolveServerFileLoggingConfig,
  resolveServerLogLevel,
  resolveServerPort,
} from './utils.js';
import {
  DEFAULT_FILE_LOG_MAX_FILES,
  DEFAULT_FILE_LOG_MAX_SIZE_MB,
  DEFAULT_FILE_LOG_MAX_TOTAL_SIZE_MB,
  DEFAULT_FILE_LOG_RETENTION_DAYS,
  DEFAULT_HTTP_BODY_LIMIT_BYTES,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
} from './defaults.js';
import { DEFAULT_SESSION_RUNTIME_LIMITS } from '../runtime/types.js';
import type { EnvironmentValues } from '@octopus/env-loader';

export const serverProxyEnvironmentKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'] as const;
let startupEnvironment: NodeJS.ProcessEnv | undefined;
let injectedKeys = new Set<string>();

/**
 * Preserves launch overrides separately from values injected from the Server file.
 */
export function getServerStartupEnvironment(): NodeJS.ProcessEnv {
  const environment = startupEnvironment ?? process.env;
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      process.platform === 'win32' ? key.toUpperCase() : key,
      value,
    ])
  );
}

/**
 * Applies persisted Server values before importing the runtime; repeated calls reload the file.
 * Launch variables win, and removed file values are removed from the process on reinitialization.
 * This is an explicit process-entry operation, never a side effect of loading configuration.
 */
export function initializeServerEnvironment(): void {
  applyServerEnvironment(prepareServerEnvironment());
}

export interface ServerEnvironmentSnapshot {
  revision: string;
  values: Readonly<NodeJS.ProcessEnv>;
  persisted: EnvironmentValues;
}

/**
 * Freezes a validated file and original launch environment without process mutation.
 */
export function prepareServerEnvironment(): ServerEnvironmentSnapshot {
  const environment = getServerStartupEnvironment();
  const candidate = environment.SERVER_DATA_DIR?.trim() || join(homedir(), '.dr-octopus', 'server');
  if (!isAbsolute(candidate) || resolve(candidate) === parse(resolve(candidate)).root) {
    throw new EnvironmentError('ENV_INVALID', 'SERVER_DATA_DIR must be an absolute non-root directory.');
  }
  const snapshot = createServerEnvironmentStore(resolve(candidate), environment).load();
  validateServerEnvironment(
    Object.fromEntries(Object.keys(snapshot.persisted).map((key) => [key, snapshot.values[key]!]))
  );
  return Object.freeze({
    revision: snapshot.revision,
    values: snapshot.values,
    persisted: snapshot.persisted,
  });
}

/**
 * Applies an accepted snapshot only after the previous runtime has released its resources.
 */
export function applyServerEnvironment(snapshot: ServerEnvironmentSnapshot): void {
  const environment = getServerStartupEnvironment();
  startupEnvironment ??= environment;
  for (const key of injectedKeys) {
    if (environment[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = environment[key];
    }
  }
  injectedKeys = new Set(Object.keys(snapshot.persisted));
  for (const key of injectedKeys) {
    process.env[key] = snapshot.values[key];
  }
}

export const serverEnvironmentDefaults: EnvironmentValues = Object.freeze({
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  SERVER_HOST: DEFAULT_SERVER_HOST,
  SERVER_PORT: String(DEFAULT_SERVER_PORT),
  SERVER_CORS_ORIGIN: '',
  SERVER_FILE_LOG_ENABLED: 'false',
  SERVER_FILE_LOG_LEVEL: '',
  SERVER_FILE_LOG_MAX_SIZE_MB: String(DEFAULT_FILE_LOG_MAX_SIZE_MB),
  SERVER_FILE_LOG_RETENTION_DAYS: String(DEFAULT_FILE_LOG_RETENTION_DAYS),
  SERVER_FILE_LOG_MAX_FILES: String(DEFAULT_FILE_LOG_MAX_FILES),
  SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: String(DEFAULT_FILE_LOG_MAX_TOTAL_SIZE_MB),
  SERVER_FILE_LOG_REQUIRED: 'false',
  SERVER_HTTP_BODY_LIMIT_BYTES: String(DEFAULT_HTTP_BODY_LIMIT_BYTES),
  SERVER_ATTACHMENT_LIMIT_BYTES: String(DEFAULT_MAX_ATTACHMENT_BYTES),
  SERVER_MAX_ACTIVE_RUNTIMES: String(DEFAULT_SESSION_RUNTIME_LIMITS.maxActiveRuntimes),
  SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: String(
    DEFAULT_SESSION_RUNTIME_LIMITS.maxActiveRuntimesPerWorkspace
  ),
});

/**
 * Rejects unknown and bootstrap-only keys, then checks business constraints even when overrides mask them.
 */
export function validateServerEnvironment(values: EnvironmentValues): void {
  for (const key of Object.keys(values)) {
    if (
      !Object.hasOwn(serverEnvironmentDefaults, key) &&
      !serverProxyEnvironmentKeys.some((name) => name === key)
    ) {
      throw new EnvironmentError('ENV_INVALID', `${key} is not an editable Server variable.`);
    }
  }
  try {
    resolveServerEnvironment(values.NODE_ENV);
    resolveServerFileLoggingConfig(values, resolveServerLogLevel(values.LOG_LEVEL));
    resolveServerPort(values.SERVER_PORT);
    resolveCorsOrigins(values.SERVER_CORS_ORIGIN);
    resolveHttpBodyLimitBytes(values.SERVER_HTTP_BODY_LIMIT_BYTES);
    resolveAttachmentLimitBytes(values.SERVER_ATTACHMENT_LIMIT_BYTES);
    resolveMaxActiveRuntimes(values.SERVER_MAX_ACTIVE_RUNTIMES);
    resolveMaxActiveRuntimesPerWorkspace(values.SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE);
  } catch (error) {
    const field =
      error instanceof Error
        ? error.message.match(/\b(?:SERVER_[A-Z_]+|LOG_LEVEL|NODE_ENV)\b/)?.[0]
        : undefined;
    throw new EnvironmentError(
      'ENV_INVALID',
      field
        ? `Invalid Server environment field: ${field}. Check its value and related limits.`
        : 'Invalid Server environment configuration. Check ports, origins, levels and limits.'
    );
  }
}

/**
 * Opens Server configuration after the caller has resolved its independent data directory.
 */
export function createServerEnvironmentStore(
  directory: string,
  environment: NodeJS.ProcessEnv = getServerStartupEnvironment(),
  diagnosticReads = false
) {
  return createEnvironmentStore({
    path: join(directory, 'environment.json'),
    environment,
    defaults: serverEnvironmentDefaults,
    validate: validateServerEnvironment,
    diagnosticReads,
  });
}
