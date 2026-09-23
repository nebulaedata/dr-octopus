/**
 * @author Codex
 * @description Owns shared revision-checked Server configuration and its HTTP projection.
 */
import fp from 'fastify-plugin';
import { registerServerSettingsController } from './server-settings.controller.js';
import { ServerConfiguration, ServerSettingsService } from './server-settings.service.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
export { ServerConfiguration, ServerSettingsService } from './server-settings.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    serverConfiguration: ServerConfiguration;
  }
}
/**
 * Shares one configuration writer across both Server settings editors.
 */
const serverSettingsModule: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  const configuration = new ServerConfiguration(options.config.paths.dataDir, options.control);
  server.decorate('serverConfiguration', configuration);
  const service = new ServerSettingsService(options.config, configuration, options.control, () => ({
    state: options.control.state(),
    address: server.listeningOrigin ?? null,
    activeRuntimeCount: server.sessionRuntime.getDiagnostics().activeRuntimeCount,
    fileLogging: {
      enabled: options.config.fileLogging.enabled,
      state: server.logging.getHealth().state,
      directory: options.config.paths.logsRoot,
    },
  }));
  server.register(
    (scope, _options, complete) => {
      registerServerSettingsController(scope, service, options.control);
      complete();
    },
    { prefix: '/api' }
  );
  done();
};
export default fp(serverSettingsModule, {
  name: 'server-settings',
  fastify: '5.x',
  decorators: { fastify: ['sessionRuntime', 'logging'] },
});
