/**
 * @author Codex
 * @description Owns Server-local ASR configuration, binary audio HTTP access and provider request cancellation.
 */
import fp from 'fastify-plugin';
import { registerErrorMessages } from '../../infrastructure/i18n/error-catalog.js';
import { SpeechRepository } from './speech.repository.js';
import { SpeechService } from './speech.service.js';
import { registerSpeechController, speechErrorMessages } from './speech.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';

/**
 * Composes one service instance with scoped routes and explicit Host cleanup.
 */
const speechModule: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  const paths = options.storagePaths ?? options.config.paths;
  const service = new SpeechService(new SpeechRepository(paths.stateRoot));
  server.addHook('preClose', () => service.close());
  registerErrorMessages('speech', speechErrorMessages);
  registerSpeechController(server, service);
  done();
};
export const autoPrefix = '/api';
export default fp(speechModule, { name: 'speech', fastify: '5.x', encapsulate: true });
