/**
 * @author Codex
 * @description Owns shared model configuration and its reconciliation lifecycle.
 */
import fp from 'fastify-plugin';
import { createPiSettingsStore } from '../../infrastructure/pi-settings/index.js';
import { registerSettingsController, registerSettingsErrorMessages } from './model-settings.controller.js';
import { ModelConfigMonitor, SettingsService, createModelConfigChanges } from './model-settings.service.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
export { ModelConfigMonitor, SettingsService, createModelConfigChanges } from './model-settings.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    settingsService: SettingsService;
    modelConfigMonitor: ModelConfigMonitor;
    piSettingsStore: ReturnType<typeof createPiSettingsStore>;
  }
}
/**
 * Shares one settings snapshot resource and preserves non-blocking initial reconciliation.
 */
const modelSettingsModule: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  const store = createPiSettingsStore({ agentDir: options.config.agentDir });
  const monitor = new ModelConfigMonitor({
    agentDir: options.config.agentDir,
    onCommitted: server.configurationChanges.publisher('model-providers'),
    refresh: async () => {
      await store.refreshCatalog?.();
    },
    notify: () => server.dataEvents.publish({ resource: 'model-config' }),
    onError: (err) => server.log.warn({ err }, 'Model configuration reconciliation failed'),
  });
  const service = new SettingsService(
    store,
    createModelConfigChanges(
      () => monitor.invalidate(),
      () => monitor.invalidate()
    )
  );
  server.decorate('piSettingsStore', store);
  server.decorate('settingsService', service);
  server.decorate('modelConfigMonitor', monitor);
  server.addHook('onClose', () => monitor.close());
  void monitor.start().catch((err) => server.log.warn({ err }, 'Initial model configuration unavailable'));
  registerSettingsErrorMessages();
  server.register(
    (scope, _options, complete) => {
      registerSettingsController(scope, service);
      complete();
    },
    { prefix: '/api' }
  );
  done();
};
export default fp(modelSettingsModule, {
  name: 'model-settings',
  fastify: '5.x',
  dependencies: ['data-events'],
  decorators: { fastify: ['configurationChanges'] },
});

export type { ModelConfigChanges } from './model-settings.service.js';
