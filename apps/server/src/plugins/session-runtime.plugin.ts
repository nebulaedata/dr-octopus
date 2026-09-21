/**
 * @author Codex
 * @description Installs the process-local Session Runtime Coordinator once and owns its Fastify shutdown lifecycle.
 */

import fp from 'fastify-plugin';
import { SessionRuntimeCoordinator } from '../lib/runtime/index.js';
import type { FastifyPluginCallback } from 'fastify';
import type { SessionRuntimeLimits } from '../lib/runtime/index.js';

export interface SessionRuntimePluginOptions {
  runtime?: SessionRuntimeCoordinator;
  limits?: Partial<SessionRuntimeLimits>;
  agentDir?: string;
  /**
   * Checks Host shutdown admission before accepting Session operations.
   */
  assertOpen?(this: void): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    sessionRuntime: SessionRuntimeCoordinator;
  }
}

/**
 * Creates or accepts the sole Coordinator owned by one Fastify instance.
 */
const registerSessionRuntime: FastifyPluginCallback<SessionRuntimePluginOptions> = (app, options, done) => {
  if (app.hasDecorator('sessionRuntime')) {
    done(new Error('Session Runtime plugin must be registered exactly once per Fastify instance.'));
    return;
  }
  const runtime =
    options.runtime ??
    new SessionRuntimeCoordinator({
      assertOpen: options.assertOpen,
      limits: options.limits,
      processOptions: options.agentDir === undefined ? undefined : { agentDir: options.agentDir },
    });
  app.decorate('sessionRuntime', runtime);
  app.addHook('onClose', () => runtime.close());
  done();
};

/**
 * Exposes the Runtime decorator to sibling plugins and declares its Fastify compatibility contract.
 */
export const sessionRuntimePlugin = fp(registerSessionRuntime, {
  name: 'session-runtime',
  fastify: '5.x',
});
