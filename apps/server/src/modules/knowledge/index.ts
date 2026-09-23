/**
 * @author Codex
 * @description Owns knowledge management and shares its authorized business capability.
 */
import { subscribeKnowledgeChanges } from '@octopus/agent';

import fp from 'fastify-plugin';
import { KnowledgeService } from './knowledge.service.js';
import { registerKnowledgeController, registerKnowledgeErrorMessages } from './knowledge.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
export { KnowledgeService } from './knowledge.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    knowledgeService: KnowledgeService;
  }
}
/**
 * Publishes one management capability without exposing its repository to other modules.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  let subscription = Promise.resolve<Awaited<ReturnType<typeof subscribeKnowledgeChanges>> | undefined>(
    undefined
  );
  server.addHook('onReady', (complete) => {
    subscription = subscribeKnowledgeChanges(
      options.config.agentDir,
      () => server.dataEvents.publish({ resource: 'knowledge' }),
      (err) => server.log.warn({ err }, 'Knowledge change stream disconnected')
    ).catch((err: unknown) => {
      server.log.warn({ err }, 'Daemon change subscription unavailable');
      return undefined;
    });
    complete();
  });
  server.addHook('preClose', async () => {
    await (await subscription)?.close();
  });
  const service = new KnowledgeService(options.config.agentDir, server.workspacesService);
  server.decorate('knowledgeService', service);
  registerKnowledgeErrorMessages();
  server.register(
    (scope, _options, complete) => {
      registerKnowledgeController(scope, service);
      complete();
    },
    { prefix: '/api' }
  );
  done();
};
export default fp(plugin, { name: 'knowledge', fastify: '5.x', dependencies: ['workspaces', 'data-events'] });
