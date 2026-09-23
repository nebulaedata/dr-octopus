/**
 * @author Codex
 * @description Owns Jev configuration HTTP access; Agent consumers read the same revisioned document.
 */
import fp from 'fastify-plugin';
import { JevSettingsService } from './jev-settings.service.js';
import { registerJevController, registerJevErrors } from './jev-settings.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';

/**
 * Register isolated routes without starting network activity or creating credential files.
 */
const jevSettingsModule: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerJevErrors();
  registerJevController(server, new JevSettingsService(options.config.agentDir));
  done();
};
export const autoPrefix = '/api';
export default fp(jevSettingsModule, { name: 'jev-settings', fastify: '5.x', encapsulate: true });
