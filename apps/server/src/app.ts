/**
 * @author Codex
 * @description Composes Fastify infrastructure, application Modules, routes, realtime, and shutdown lifecycle.
 */

import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { ConfigurationQueue } from './infrastructure/lifecycle/control.js';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { toPublicError } from './infrastructure/errors/public-error.js';
import { negotiateLocale } from './infrastructure/i18n/negotiate-locale.js';
import { createServerLoggerRuntime } from './infrastructure/logging/server-logger.js';
import { businessModulesPlugin } from './plugins/business-modules.plugin.js';
import { isAllowedOrigin } from './utils/http-origin.js';
import { controlError } from './infrastructure/lifecycle/control.js';
import { loadServerConfig } from './infrastructure/config/config.js';
import { databasePlugin } from './plugins/database.plugin.js';
import { sessionRuntimePlugin } from './plugins/session-runtime.plugin.js';
import { registerWebAssets } from './plugins/web-assets.plugin.js';
import type { FastifyInstance } from 'fastify';
import type { ServerControl } from './infrastructure/lifecycle/control.js';
import type { ServerConfig } from './infrastructure/config/utils.js';
import type { SessionRuntimeCoordinator } from './infrastructure/runtime/index.js';
import type { ServerPaths } from './infrastructure/config/server-paths.js';

export interface CreateServerOptions {
  control?: ServerControl;
  runtime?: SessionRuntimeCoordinator;
  databasePath?: string;
  config?: ServerConfig;
}

/**
 * Resolves storage paths for production and programmatic database overrides without leaking cwd.
 *
 * @param configured Canonical process-wide path layout.
 * @param databasePath Effective database selected by the composition root.
 * @returns Explicit persistent storage paths, or undefined for isolated in-memory tests.
 */
function resolveEffectiveStoragePaths(
  configured: ServerPaths,
  databasePath: string
): ServerPaths | undefined {
  if (databasePath === ':memory:') {
    return undefined;
  }
  if (databasePath === configured.databasePath) {
    return configured;
  }
  throw new Error('Programmatic databasePath overrides must use :memory: or the configured global database.');
}

/**
 * Creates the composition root while domain and transport behavior remain behind focused modules.
 */
export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  const config = options.config ?? loadServerConfig();
  const control = options.control ?? {
    instanceId: randomUUID(),
    queue: new ConfigurationQueue(),
    assertOpen() {},
    state: () => 'running' as const,
  };
  const databasePath = options.databasePath ?? config.paths.databasePath;
  const storagePaths = resolveEffectiveStoragePaths(config.paths, databasePath);
  const logging = createServerLoggerRuntime({
    level: config.logLevel,
    pretty: config.environment !== 'production',
    logsRoot: config.paths.logsRoot,
    fileLogging: config.fileLogging,
  });

  const { maxActiveRuntimes, maxActiveRuntimesPerWorkspace } = config;

  const allowOrigin = (origin: string) => config.corsOrigins.includes(origin);

  const server = Fastify({
    loggerInstance: logging.logger,
    bodyLimit: config.httpBodyLimitBytes,
  });
  server.decorate('logging', logging);
  server.addHook('onReady', () => logging.ready());

  server.log.info({ phase: 'bootstrap' }, 'Initializing Dr.Octopus server');

  // Infrastructure
  server.addHook('onRequest', (request, reply, done) => {
    if (request.headers.upgrade?.toLowerCase() === 'websocket') {
      reply.raw.once('finish', () => {
        if (reply.statusCode >= 400) {
          request.raw.socket.destroy();
        }
      });
    }
    const path = request.url.split('?')[0];
    if (path === '/ws' || path === '/api/data/events') {
      control.assertOpen();
    }
    if (!isAllowedOrigin(request.headers.origin, allowOrigin, request)) {
      reply.header('Connection', 'close');
      reply.header('Cache-Control', 'no-store').header('X-Request-Id', request.id);
      throw controlError('SERVER_SETTINGS_ORIGIN_REJECTED', 'Origin is not allowed.', 403);
    }
    done();
  });
  server.register(cors, {
    origin(origin, callback) {
      if (origin === undefined) {
        return callback(null, true);
      }
      callback(null, true);
    },
  });
  server.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  server.setErrorHandler((error, request, reply) => {
    const projected = toPublicError(error, negotiateLocale(request.headers['accept-language']));
    request.log.warn({ requestId: request.id, code: projected.code }, 'Request failed');
    reply.status(projected.statusCode).send({
      code: projected.code,
      message: projected.message,
      requestId: request.id,
      retryable: projected.retryable,
      ...(projected.details ? { details: projected.details } : {}),
    });
  });

  // Plugins
  server.register(sessionRuntimePlugin, {
    runtime: options.runtime,
    limits: {
      maxActiveRuntimes,
      maxActiveRuntimesPerWorkspace,
    },
    agentDir: config.agentDir,
    assertOpen: () => control.assertOpen(),
  });
  server.register(databasePlugin, {
    path: databasePath,
  });

  // Application Modules
  server.register(async (scope) => {
    await scope.register(businessModulesPlugin, {
      config,
      storagePaths,
      allowOrigin,
      control,
      capabilityLimits: {
        maxAttachmentBytes: config.attachmentLimitBytes,
        maxAttachmentsPerMessage: 10,
        maxAttachmentMessageBytes: config.attachmentLimitBytes * 10,
        tusChunkBytes: 8 * 1024 * 1024,
        maxPromptCharacters: 100_000,
        maxSubscriptionsPerConnection: 32,
        maxWebSocketMessageBytes: 512 * 1024,
      },
    });
  });

  if (config.webRoot) {
    server.register(async (scope) => registerWebAssets(scope, config.webRoot!));
  }

  // Shutdown
  server.addHook('onClose', async () => {
    server.log.info({ phase: 'shutdown' }, 'Closing server resources');
    await logging.close();
  });

  server.log.info({ phase: 'bootstrap' }, 'Server modules registered');
  return server;
}
