/**
 * @author Codex
 * @description Loads only business module entrypoints while retaining their explicit Fastify scopes.
 */
import autoload from '@fastify/autoload';
import fp from 'fastify-plugin';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginCallback } from 'fastify';
import type { ServerConfig } from '../infrastructure/config/utils.js';
import type { ServerPaths } from '../infrastructure/config/server-paths.js';
import type { ServerControl } from '../infrastructure/lifecycle/control.js';
import type { OctopusCapabilities } from '@octopus/shared/protocol';

export interface BusinessModulesOptions {
  capabilityLimits: OctopusCapabilities['limits'];
  config: ServerConfig;
  control: ServerControl;
  storagePaths?: ServerPaths;
  allowOrigin: string[] | ((origin: string) => boolean);
  directory?: string;
}

/**
 * Queue discovery without awaiting descendants inside this registration-only wrapper.
 * Fastify still waits for every child before readiness and applies the Host's timeout policy.
 */
const registerBusinessModules: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  server.register(autoload, {
    dir: options.directory ?? fileURLToPath(new URL('../modules/', import.meta.url)),
    forceESM: true,
    maxDepth: 1,
    dirNameRoutePrefix: false,
    encapsulate: true,
    indexPattern: /^index\.(?:ts|js)$/,
    scriptPattern: /(?<!\.d)\.(?:ts|js)$/,
    matchFilter: /^\/[^/]+\/index\.(?:ts|js)$/,
    options,
  });
  done();
};

export const businessModulesPlugin = fp(registerBusinessModules, {
  name: 'business-modules',
  fastify: '5.x',
});
