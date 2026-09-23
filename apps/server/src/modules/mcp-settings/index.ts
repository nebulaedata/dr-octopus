/**
 * @author Codex
 * @description Assembles mcp-settings with explicit resources and an isolated HTTP scope.
 */
import fp from 'fastify-plugin';
import { createPiMcpStore } from '../../infrastructure/pi-mcp/index.js';
import { registerMcpSettingsController } from './mcp-settings.controller.js';
import { McpSettingsService } from './mcp-settings.service.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Registers the module's existing HTTP contract.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerMcpSettingsController(
    server,
    new McpSettingsService(createPiMcpStore({ agentDir: options.config.agentDir }))
  );
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, { name: 'mcp-settings', fastify: '5.x', encapsulate: true, dependencies: [] });
