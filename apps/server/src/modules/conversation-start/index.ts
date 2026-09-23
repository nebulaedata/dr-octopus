/**
 * @author Codex
 * @description Owns first-message acceptance while preserving the shared SQLite publication transaction.
 */
import fp from 'fastify-plugin';
import { ConversationStartService } from './conversation-start.service.js';
import { ConversationStartRepository } from './conversation-start.repository.js';
import { registerConversationStartController } from './conversation-start.controller.js';
import type { FastifyPluginCallback } from 'fastify';
/**
 * Registers first-message admission after all required business capabilities are ready.
 */
const plugin: FastifyPluginCallback = (server, _options, done) => {
  const service = new ConversationStartService({
    repository: new ConversationStartRepository(server.database),
    sessions: server.sessionsService,
    settings: server.settingsService,
    channel: server.sessionChannelService,
    attachments: server.attachmentsService,
    configuration: () => server.modelConfigMonitor.refresh(),
    assertWorkspace: (id) => server.workspacesService.resolve({ id }),
    onChanged: (workspaceId) => server.dataEvents.publish({ resource: 'conversation-starts', workspaceId }),
  });
  server.addHook('onClose', () => service.close());
  registerConversationStartController(server, service);
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, {
  name: 'conversation-start',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['channel'],
});
