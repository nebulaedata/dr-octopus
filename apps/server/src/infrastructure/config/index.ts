/**
 * @author Codex
 * @description Exposes the complete Octopus Server configuration and path-resolution surface.
 */

export { loadServerConfig } from './config.js';
export {
  DEFAULT_HTTP_BODY_LIMIT_BYTES,
  DEFAULT_FILE_LOG_MAX_FILES,
  DEFAULT_FILE_LOG_MAX_SIZE_MB,
  DEFAULT_FILE_LOG_MAX_TOTAL_SIZE_MB,
  DEFAULT_FILE_LOG_RETENTION_DAYS,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
} from './defaults.js';
export { AGENT_DIR_ENV, SERVER_DATA_DIR_ENV, resolveAgentDir, resolveServerPaths } from './server-paths.js';
export type { ServerPaths } from './server-paths.js';
export type { ServerConfig, ServerFileLoggingConfig } from './utils.js';
