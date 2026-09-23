/**
 * @author Codex
 * @description Owns interactive Provider authentication and isolates its request hooks.
 */
import fp from 'fastify-plugin';
import { createModelConfigChanges } from '../model-settings/index.js';
import { registerProviderAuthController } from './provider-auth.controller.js';
import { ProviderAuthService } from './provider-auth.service.js';
import type { FastifyPluginCallback } from 'fastify';
/**
 * Uses model identity and configuration invalidation without duplicating model state.
 */
const providerAuthModule: FastifyPluginCallback = (server, _options, done) => {
  const service = new ProviderAuthService(
    server.settingsService,
    server.piSettingsStore,
    createModelConfigChanges({ record: () => server.modelConfigMonitor.invalidate() }, () =>
      server.modelConfigMonitor.invalidate()
    ),
    () => server.dataEvents.publish({ resource: 'provider-auth' })
  );
  server.addHook('onClose', () => service.close());
  registerProviderAuthController(server, service);
  done();
};
export const autoPrefix = '/api';
export default fp(providerAuthModule, {
  name: 'provider-auth',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['model-settings'],
});
