/**
 * @author Codex
 * @description Defines Server configuration contracts, defaults, and environment-value resolvers.
 */

import {
  DEFAULT_HTTP_BODY_LIMIT_BYTES,
  DEFAULT_FILE_LOG_MAX_FILES,
  DEFAULT_FILE_LOG_MAX_SIZE_MB,
  DEFAULT_FILE_LOG_MAX_TOTAL_SIZE_MB,
  DEFAULT_FILE_LOG_RETENTION_DAYS,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
} from './defaults.js';
import { DEFAULT_SESSION_RUNTIME_LIMITS } from '../runtime/types.js';
import type { ServerPaths } from './server-paths.js';

export { DEFAULT_HTTP_BODY_LIMIT_BYTES } from './defaults.js';

export interface ServerConfig {
  webRoot?: string;
  environment: ServerEnvironment;
  logLevel: ServerLogLevel;
  fileLogging: ServerFileLoggingConfig;
  host: string;
  port: number;
  corsOrigins: string[];
  httpBodyLimitBytes: number;
  attachmentLimitBytes: number;
  maxActiveRuntimes: number;
  maxActiveRuntimesPerWorkspace: number;
  paths: ServerPaths;
  agentDir: string;
}

export interface ServerFileLoggingConfig {
  enabled: boolean;
  level: ServerLogLevel;
  maxSizeMb: number;
  retentionDays: number;
  maxFiles: number;
  maxTotalSizeMb: number;
  required: boolean;
}

/**
 * Resolves the Server listening host.
 *
 * @param value Raw SERVER_HOST value.
 * @returns A configured host or the loopback default.
 */
export function resolveServerHost(value: string | undefined): string {
  return value?.trim() || DEFAULT_SERVER_HOST;
}

/**
 * Resolves and bounds the Server listening port.
 *
 * @param value Raw SERVER_PORT value.
 * @returns A valid TCP port.
 * @throws When the configured value is not a valid TCP port.
 */
export function resolveServerPort(value: string | undefined): number {
  const port = resolvePositiveInteger(value, DEFAULT_SERVER_PORT, 'SERVER_PORT');
  if (port > 65_535) {
    throw new Error('SERVER_PORT must not exceed 65535.');
  }
  return port;
}

/**
 * Parses the optional comma-separated browser-origin allowlist.
 *
 * @param value Raw SERVER_CORS_ORIGIN value.
 * @returns Normalized origins; an empty list selects the local-origin policy.
 */
export function resolveCorsOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }
  return [
    ...new Set(
      value.split(',').map((origin) => {
        if (!URL.canParse(origin.trim()) || /[?#]/.test(origin)) {
          throw new Error('SERVER_CORS_ORIGIN must contain HTTP(S) origins without query or fragment.');
        }
        const url = new URL(origin.trim());
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash ||
          url.hostname.includes('*')
        ) {
          throw new Error('SERVER_CORS_ORIGIN must contain HTTP(S) origins without paths or credentials.');
        }
        return url.origin;
      })
    ),
  ];
}

/**
 * Resolves the Fastify request-body limit.
 *
 * @param value Raw SERVER_HTTP_BODY_LIMIT_BYTES value.
 * @returns A positive safe byte count.
 * @throws When the configured value is not a positive safe integer.
 */
export function resolveHttpBodyLimitBytes(value: string | undefined): number {
  return resolvePositiveInteger(value, DEFAULT_HTTP_BODY_LIMIT_BYTES, 'SERVER_HTTP_BODY_LIMIT_BYTES');
}

/**
 * Resolves the staged-attachment size limit.
 *
 * @param value Raw SERVER_ATTACHMENT_LIMIT_BYTES value.
 * @returns A positive safe byte count.
 * @throws When the configured value is not a positive safe integer.
 */
export function resolveAttachmentLimitBytes(value: string | undefined): number {
  return resolvePositiveInteger(value, DEFAULT_MAX_ATTACHMENT_BYTES, 'SERVER_ATTACHMENT_LIMIT_BYTES');
}

/**
 * Resolves the global resident Session runtime limit.
 *
 * @param value Raw SERVER_MAX_ACTIVE_RUNTIMES value.
 * @returns A positive runtime capacity.
 * @throws When the configured value is not a positive safe integer.
 */
export function resolveMaxActiveRuntimes(value: string | undefined): number {
  return resolvePositiveInteger(
    value,
    DEFAULT_SESSION_RUNTIME_LIMITS.maxActiveRuntimes,
    'SERVER_MAX_ACTIVE_RUNTIMES'
  );
}

/**
 * Resolves the resident Session runtime limit for one Workspace.
 *
 * @param value Raw SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE value.
 * @returns A positive per-Workspace runtime capacity.
 * @throws When the configured value is not a positive safe integer.
 */
export function resolveMaxActiveRuntimesPerWorkspace(value: string | undefined): number {
  return resolvePositiveInteger(
    value,
    DEFAULT_SESSION_RUNTIME_LIMITS.maxActiveRuntimesPerWorkspace,
    'SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE'
  );
}

export type ServerEnvironment = 'development' | 'production' | 'test';
export type ServerLogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/**
 * Resolves the process environment used by logging and startup presentation.
 *
 * @param value Raw NODE_ENV value.
 * @returns A supported environment with development as the local default.
 * @throws When NODE_ENV is not one of the supported values.
 */
export function resolveServerEnvironment(value: string | undefined): ServerEnvironment {
  const environment = value?.trim() || 'development';
  if (environment !== 'development' && environment !== 'production' && environment !== 'test') {
    throw new Error('NODE_ENV must be development, production, or test.');
  }
  return environment;
}

/**
 * Resolves the bounded Pino log level used by the Server logger.
 *
 * @param value Raw LOG_LEVEL value.
 * @returns A supported Pino level with info as the default.
 * @throws When LOG_LEVEL is unsupported.
 */
export function resolveServerLogLevel(value: string | undefined): ServerLogLevel {
  const level = value?.trim() || 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(level)) {
    throw new Error('LOG_LEVEL must be fatal, error, warn, info, debug, trace, or silent.');
  }
  return level as ServerLogLevel;
}

/**
 * Resolves one optional boolean environment flag without accepting ambiguous truthy values.
 *
 * @param value Raw environment value.
 * @param fallback Value used when the environment entry is absent or blank.
 * @param name Environment variable name used in diagnostics.
 * @returns The validated boolean value.
 * @throws When the value is not true, false, 1, or 0.
 */
export function resolveBooleanFlag(value: string | undefined, fallback: boolean, name: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error(`${name} must be true, false, 1, or 0.`);
}

/**
 * Resolves the optional local file logging policy as one complete validated contract.
 *
 * @param env Environment values supplied to the Server process.
 * @param inheritedLevel Stdout log level inherited when no file-specific level is configured.
 * @returns File logging settings with conservative bounded defaults.
 * @throws When a flag, level, or numeric bound is invalid.
 */
export function resolveServerFileLoggingConfig(
  env: NodeJS.ProcessEnv,
  inheritedLevel: ServerLogLevel
): ServerFileLoggingConfig {
  const config: ServerFileLoggingConfig = {
    enabled: resolveBooleanFlag(env['SERVER_FILE_LOG_ENABLED'], false, 'SERVER_FILE_LOG_ENABLED'),
    level: resolveOptionalServerLogLevel(env['SERVER_FILE_LOG_LEVEL'], inheritedLevel),
    maxSizeMb: resolveBoundedPositiveInteger(
      env['SERVER_FILE_LOG_MAX_SIZE_MB'],
      DEFAULT_FILE_LOG_MAX_SIZE_MB,
      'SERVER_FILE_LOG_MAX_SIZE_MB',
      1024
    ),
    retentionDays: resolveBoundedPositiveInteger(
      env['SERVER_FILE_LOG_RETENTION_DAYS'],
      DEFAULT_FILE_LOG_RETENTION_DAYS,
      'SERVER_FILE_LOG_RETENTION_DAYS',
      365
    ),
    maxFiles: resolveFileLogMaxFiles(env['SERVER_FILE_LOG_MAX_FILES']),
    maxTotalSizeMb: resolveBoundedPositiveInteger(
      env['SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB'],
      DEFAULT_FILE_LOG_MAX_TOTAL_SIZE_MB,
      'SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB',
      102_400
    ),
    required: resolveBooleanFlag(env['SERVER_FILE_LOG_REQUIRED'], false, 'SERVER_FILE_LOG_REQUIRED'),
  };
  if (config.required && !config.enabled) {
    throw new Error('SERVER_FILE_LOG_REQUIRED requires SERVER_FILE_LOG_ENABLED=true.');
  }
  if (config.maxTotalSizeMb < config.maxSizeMb) {
    throw new Error('SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB must be at least SERVER_FILE_LOG_MAX_SIZE_MB.');
  }
  return config;
}

/**
 * Keeps space for one active and at least one rotated file.
 *
 * @param value Raw SERVER_FILE_LOG_MAX_FILES value.
 * @returns A bounded file count of at least two.
 * @throws When fewer than two files or more than one thousand files are requested.
 */
function resolveFileLogMaxFiles(value: string | undefined): number {
  const resolved = resolveBoundedPositiveInteger(
    value,
    DEFAULT_FILE_LOG_MAX_FILES,
    'SERVER_FILE_LOG_MAX_FILES',
    1000
  );
  if (resolved < 2) {
    throw new Error('SERVER_FILE_LOG_MAX_FILES must be at least 2.');
  }
  return resolved;
}

/**
 * Resolves a file-specific log level while allowing an inherited blank value.
 *
 * @param value Raw SERVER_FILE_LOG_LEVEL value.
 * @param fallback Validated process-wide level.
 * @returns A validated explicit level or the inherited fallback.
 */
function resolveOptionalServerLogLevel(value: string | undefined, fallback: ServerLogLevel): ServerLogLevel {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return resolveServerLogLevel(value);
}

/**
 * Resolves a positive integer and enforces a defensive operational ceiling.
 *
 * @param value Raw environment value.
 * @param fallback Default value.
 * @param name Environment variable name used in diagnostics.
 * @param maximum Inclusive upper bound.
 * @returns A bounded positive integer.
 * @throws When the value exceeds the documented bound.
 */
function resolveBoundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum: number
): number {
  const resolved = resolvePositiveInteger(value, fallback, name);
  if (resolved > maximum) {
    throw new Error(`${name} must not exceed ${String(maximum)}.`);
  }
  return resolved;
}

/**
 * Parses a positive safe integer while retaining a documented default.
 *
 * @param value Raw environment value.
 * @param fallback Value used when the environment entry is absent or blank.
 * @param name Environment variable name used in diagnostics.
 * @returns A positive safe integer.
 * @throws When the configured value is not a positive safe integer.
 */
function resolvePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}
