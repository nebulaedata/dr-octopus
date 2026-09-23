/**
 * @author Codex
 * @description Owns the shared invalidation stream and isolates its HTTP subscription lifecycle.
 */
import fp from 'fastify-plugin';
import { registerDataEventsController } from './data-events.controller.js';
import { DataEventsService } from './data-events.service.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
export { DataEventsService } from './data-events.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    dataEvents: DataEventsService;
  }
}
/**
 * Publishes one event stream and registers isolated SSE routes.
 */
const dataEventsModule: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  const events = new DataEventsService();
  server.decorate('dataEvents', events);
  const unsubscribe = options.control.subscribe?.(() => events.publish({ resource: 'server-lifecycle' }));
  server.addHook('onClose', (_instance, complete) => {
    unsubscribe?.();
    complete();
  });
  server.register(
    (scope, _options, complete) => {
      registerDataEventsController(scope, events, options.allowOrigin);
      complete();
    },
    {
      prefix: '/api',
    }
  );
  done();
};
export default fp(dataEventsModule, { name: 'data-events', fastify: '5.x' });
