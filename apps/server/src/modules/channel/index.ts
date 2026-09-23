/**
 * @author Codex
 * @description Owns realtime channel state, WebSocket transport, and focused-session completion notices.
 */
import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import { ChannelService, createKnowledgeAttachmentContext } from './channel.service.js';
import { registerChannelController } from './channel.controller.js';
import { subscribeSessionCompletionNotices } from '../sessions/index.js';
import { isAllowedOrigin } from '../../utils/http-origin.js';
import type { FastifyPluginAsync } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
export { ChannelService } from './channel.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    sessionChannelService: ChannelService;
  }
}
/**
 * Shares one channel and installs WebSocket interception before registering its route.
 */
const plugin: FastifyPluginAsync<BusinessModulesOptions> = async (server, options) => {
  const service = new ChannelService(
    {
      sessionsService: server.sessionsService,
      attachmentsService: server.attachmentsService,
      attachmentDeliveryService: server.attachmentDeliveryService,
      prepareKnowledgeAttachments: createKnowledgeAttachmentContext(
        options.config.agentDir,
        server.attachmentsService,
        server.sessionsService
      ),
      resolveWorkspaceCwd: async (workspaceId) =>
        (await server.workspacesService.resolve({ id: workspaceId })).cwd,
      resolveWorkspaceReferences: (workspaceId, references) =>
        server.workspacesService.resolveReferences(workspaceId, references),
    },
    { maxSubscriptions: options.capabilityLimits.maxSubscriptionsPerConnection }
  );
  server.decorate('sessionChannelService', service);
  const unsubscribe = subscribeSessionCompletionNotices(
    server.sessionsService,
    server.sessionsService.notifications,
    (err) => server.log.error({ err }, 'Session notification publication failed'),
    (id) => service.isSessionFocused(id)
  );
  server.addHook('onClose', (_instance, complete) => {
    unsubscribe();
    complete();
  });
  await server.register(async (scope) => {
    await scope.register(websocket, {
      options: {
        maxPayload: options.capabilityLimits.maxWebSocketMessageBytes,
        verifyClient(info, callback) {
          if (
            isAllowedOrigin(info.origin, options.allowOrigin, {
              headers: info.req.headers,
              protocol: info.secure ? 'https' : 'http',
            })
          ) {
            callback(true);
            return;
          }
          callback(false, 403, 'Origin is not allowed');
        },
      },
    });
    registerChannelController(scope, service);
  });
};
export default fp(plugin, {
  name: 'channel',
  fastify: '5.x',
  dependencies: ['sessions', 'attachment-delivery'],
});
