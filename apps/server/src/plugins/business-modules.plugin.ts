/**
 * @author Codex
 * @description Loads only business module entrypoints while retaining their explicit Fastify scopes.
 */
import autoload from '@fastify/autoload';
import fp from 'fastify-plugin';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';
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
 * Discovers immediate module entrypoints without treating implementations or workers as plugins.
 */
const registerBusinessModules: FastifyPluginAsync<BusinessModulesOptions> = async (server, options) => {
  await server.register(autoload, {
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
};

export const businessModulesPlugin = fp(registerBusinessModules, {
  name: 'business-modules',
  fastify: '5.x',
});
