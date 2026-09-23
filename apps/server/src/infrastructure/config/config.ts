/**
 * @author Codex
 * @description Composes the Server's process-level environment configuration.
 */

import {
  resolveAttachmentLimitBytes,
  resolveCorsOrigins,
  resolveHttpBodyLimitBytes,
  resolveMaxActiveRuntimes,
  resolveMaxActiveRuntimesPerWorkspace,
  resolveServerHost,
  resolveServerEnvironment,
  resolveServerFileLoggingConfig,
  resolveServerLogLevel,
  resolveServerPort,
} from './utils.js';
import { resolveAgentDir, resolveServerPaths } from './server-paths.js';
import { createServerEnvironmentStore } from './environment.js';
import type { ServerConfig } from './utils.js';

/**
 * Resolves the complete Server configuration from an environment mapping.
 *
 * @param env Environment values supplied by the process or a deterministic test fixture.
 * @returns Validated values ready for the Server composition root.
 * @throws When a configured port, origin, or byte limit is invalid.
 */
export function loadServerConfig(env?: NodeJS.ProcessEnv): ServerConfig {
  // Explicit mappings remain deterministic for embedding/tests. Production loads the user's file.
  env ??= createServerEnvironmentStore(resolveServerPaths().dataDir).load().values;
  const paths = resolveServerPaths(env);
  const logLevel = resolveServerLogLevel(env['LOG_LEVEL']);
  return {
    ...(env['SERVER_WEB_ROOT']?.trim() ? { webRoot: env['SERVER_WEB_ROOT'].trim() } : {}),
    environment: resolveServerEnvironment(env['NODE_ENV']),
    logLevel,
    fileLogging: resolveServerFileLoggingConfig(env, logLevel),
    host: resolveServerHost(env['SERVER_HOST']),
    port: resolveServerPort(env['SERVER_PORT']),
    corsOrigins: resolveCorsOrigins(env['SERVER_CORS_ORIGIN']),
    httpBodyLimitBytes: resolveHttpBodyLimitBytes(env['SERVER_HTTP_BODY_LIMIT_BYTES']),
    attachmentLimitBytes: resolveAttachmentLimitBytes(env['SERVER_ATTACHMENT_LIMIT_BYTES']),
    maxActiveRuntimes: resolveMaxActiveRuntimes(env['SERVER_MAX_ACTIVE_RUNTIMES']),
    maxActiveRuntimesPerWorkspace: resolveMaxActiveRuntimesPerWorkspace(
      env['SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE']
    ),
    paths,
    agentDir: resolveAgentDir(env),
  };
}
