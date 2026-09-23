/**
 * @author Codex
 * @description Assembles environment-settings with explicit resources and an isolated HTTP scope.
 */
import fp from 'fastify-plugin';

import { registerEnvironmentSettingsController } from './environment-settings.controller.js';
import { EnvironmentSettingsService } from './environment-settings.service.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Registers the module's existing HTTP contract.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerEnvironmentSettingsController(
    server,
    new EnvironmentSettingsService(
      options.config.paths.dataDir,
      options.config.agentDir,
      undefined,
      server.serverConfiguration
    )
  );
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, {
  name: 'environment-settings',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['server-settings'],
});
