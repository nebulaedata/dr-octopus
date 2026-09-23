/**
 * @author Codex
 * @description Projects effective Server fields and classifies listener exposure without DNS lookups.
 */
import { isIP } from 'node:net';
import type { ServerConfig } from './utils.js';

/**
 * Treats unknown hostnames and wildcard listeners as exposed; only numeric loopback is trusted.
 */
export function isLoopbackHost(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    value === '::1' ||
    value === '0:0:0:0:0:0:0:1' ||
    (isIP(value) === 4 && value.startsWith('127.')) ||
    (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 && value.slice(7).startsWith('127.'))
  );
}

/**
 * Reads actual normalized configuration, including inherited log levels.
 */
export function serverFieldValues(config: ServerConfig) {
  return {
    SERVER_HOST: config.host,
    SERVER_PORT: config.port,
    SERVER_CORS_ORIGIN: config.corsOrigins.join(','),
    SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: config.maxActiveRuntimesPerWorkspace,
    SERVER_MAX_ACTIVE_RUNTIMES: config.maxActiveRuntimes,
    SERVER_FILE_LOG_ENABLED: config.fileLogging.enabled,
    SERVER_FILE_LOG_LEVEL: config.fileLogging.level,
    SERVER_FILE_LOG_MAX_SIZE_MB: config.fileLogging.maxSizeMb,
    SERVER_FILE_LOG_RETENTION_DAYS: config.fileLogging.retentionDays,
    SERVER_FILE_LOG_MAX_FILES: config.fileLogging.maxFiles,
    SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: config.fileLogging.maxTotalSizeMb,
    SERVER_FILE_LOG_REQUIRED: config.fileLogging.required,
  };
}
