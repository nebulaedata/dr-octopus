/**
 * @author Codex
 * @description Assembles permission-settings with explicit resources and an isolated HTTP scope.
 */
import fp from 'fastify-plugin';

import { registerPermissionSettingsController } from './permission-settings.controller.js';
import { PermissionSettingsService } from './permission-settings.service.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Registers the module's existing HTTP contract.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerPermissionSettingsController(
    server,
    new PermissionSettingsService(options.config.agentDir, server.workspacesService)
  );
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, {
  name: 'permission-settings',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['workspaces'],
});
