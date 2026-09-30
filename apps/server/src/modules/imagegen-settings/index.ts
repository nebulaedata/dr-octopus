/**
 * @author Codex
 * @description Composes independent image-service settings backed by the shared Agent imagegen configuration.
 */
import fp from 'fastify-plugin';
import { registerErrorMessages } from '../../infrastructure/i18n/error-catalog.js';
import { registerImagegenSettingsController, imagegenErrorMessages } from './imagegen-settings.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';

/**
 * Registers settings without loading the chat model catalog or creating credentials.
 */
const imagegenSettingsModule: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerErrorMessages('imagegen-settings', imagegenErrorMessages);
  registerImagegenSettingsController(server, options.config.agentDir);
  done();
};
export const autoPrefix = '/api';
export default fp(imagegenSettingsModule, { name: 'imagegen-settings', fastify: '5.x', encapsulate: true });
