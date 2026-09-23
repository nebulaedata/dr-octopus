/**
 * @author Codex
 * @description Assembles lazy Agent memory access and owns its cleanup.
 */
import { subscribeMemoryChanges } from '@octopus/agent';
import fp from 'fastify-plugin';
import { registerMemoryController, registerMemoryErrorMessages } from './memory.controller.js';

import { MemoryService } from './memory.service.js';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
import type { FastifyPluginCallback } from 'fastify';
/**
 * Keeps memory resource disposal in the plugin lifecycle.
 */
const memoryModule: FastifyPluginCallback<BusinessModulesOptions> = (server, _options, done) => {
  let subscription = Promise.resolve<Awaited<ReturnType<typeof subscribeMemoryChanges>> | undefined>(
    undefined
  );
  server.addHook('onReady', (complete) => {
    subscription = subscribeMemoryChanges(
      undefined,
      () => server.dataEvents.publish({ resource: 'memory' }),
      (err) => server.log.warn({ err }, 'Memory change stream disconnected')
    ).catch((err: unknown) => {
      server.log.warn({ err }, 'Daemon change subscription unavailable');
      return undefined;
    });
    complete();
  });
  server.addHook('preClose', async () => {
    await (await subscription)?.close();
  });
  const service = new MemoryService();
  server.addHook('onClose', () => service.close());
  registerMemoryController(server, service);
  registerMemoryErrorMessages();
  done();
};
export const autoPrefix = '/api';
export default fp(memoryModule, {
  name: 'memory',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['data-events'],
});
