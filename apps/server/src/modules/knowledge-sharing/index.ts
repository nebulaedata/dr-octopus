/**
 * @author Codex
 * @description Registers the independently authorized read-only knowledge MCP transport.
 */
import fp from 'fastify-plugin';
import { createKnowledgeSharingClient } from './knowledge-sharing.service.js';
import { registerKnowledgeMcpController } from './knowledge-sharing.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Keeps MCP at its existing root path and listens only for knowledge invalidations.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerKnowledgeMcpController(server, createKnowledgeSharingClient(options.config.agentDir), (listener) =>
    server.dataEvents.subscribe((change) => {
      if (change.resource === 'knowledge') {
        listener();
      }
    })
  );
  done();
};
export default fp(plugin, {
  name: 'knowledge-sharing',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['data-events'],
});
