/**
 * @author Codex
 * @description Assembles readiness and capability routes from shared database, runtime, and logging resources.
 */
import fp from 'fastify-plugin';
import { HealthService } from './health.service.js';
import { isDatabaseReady } from '../../plugins/database.plugin.js';
import { registerHealthController } from './health.controller.js';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { CapabilityLimits } from './health.controller.js';

/**
 * Registers health routes inside the module's encapsulated transport scope.
 */
const healthModule: FastifyPluginCallback<{ capabilityLimits: CapabilityLimits }> = (
  server,
  options,
  done
) => {
  registerHealthController(
    server,
    options.capabilityLimits,
    createHealthService({
      database: server.database,
      sessionRuntime: server.sessionRuntime,
      logging: server.logging,
    })
  );
  done();
};

export default fp(healthModule, {
  name: 'health',
  fastify: '5.x',
  encapsulate: true,
  decorators: { fastify: ['database', 'sessionRuntime', 'logging'] },
});

export const autoPrefix = '/api';

/**
 * Adapts infrastructure capabilities to pure readiness probes.
 */
export function createHealthService(
  resources: Pick<FastifyInstance, 'database' | 'sessionRuntime' | 'logging'>
): HealthService {
  return new HealthService({
    database: () => isDatabaseReady(resources.database),
    runtime: () => resources.sessionRuntime.isAcceptingRequests(),
    logging: () => resources.logging.getHealth(),
  });
}
