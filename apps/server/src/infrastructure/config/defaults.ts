/**
 * @author Codex
 * @description Defines process-wide Server defaults shared by configuration and consuming business modules.
 */

export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 3000;
export const DEFAULT_HTTP_BODY_LIMIT_BYTES = 140 * 1024 * 1024;
export const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const DEFAULT_FILE_LOG_MAX_SIZE_MB = 50;
export const DEFAULT_FILE_LOG_RETENTION_DAYS = 14;
export const DEFAULT_FILE_LOG_MAX_FILES = 30;
export const DEFAULT_FILE_LOG_MAX_TOTAL_SIZE_MB = 1024;
