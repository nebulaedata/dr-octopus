/**
 * @author Codex
 * @description Owns the session aggregate, its durable and draft state, and isolated HTTP endpoints.
 */
import fp from 'fastify-plugin';
import { SessionsService } from './sessions.service.js';
import {
  SessionsRepository,
  MessageFeedbackRepository,
  SessionNotificationsRepository,
} from './sessions.repository.js';
import {
  registerSessionsController,
  registerSessionDraftsController,
  registerSessionNotificationsController,
  registerSessionErrorMessages,
} from './sessions.controller.js';
import type { FastifyBaseLogger, FastifyPluginCallback } from 'fastify';
import type { OctopusDatabase } from '../../db/client.js';
import type { SessionRuntimeCoordinator } from '../../infrastructure/runtime/index.js';
import type { SessionsServiceOptions } from './sessions.service.js';
export {
  SessionsService,
  subscribeSessionCompletionNotices,
  projectHostVisibleUserMessage,
} from './sessions.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    sessionsService: SessionsService;
  }
}
/**
 * Assembles session resources without exposing the Host instance to domain logic.
 */
export function createSessionsService(
  resources: {
    database: OctopusDatabase;
    sessionRuntime: SessionRuntimeCoordinator;
    log?: FastifyBaseLogger;
  },
  options: SessionsServiceOptions & { notificationsRepository?: SessionNotificationsRepository }
): SessionsService {
  return new SessionsService({
    ...options,
    runtime: options.runtime ?? resources.sessionRuntime,
    sessionsRepository: options.sessionsRepository ?? new SessionsRepository(resources.database),
    messageFeedbackRepository:
      options.messageFeedbackRepository ?? new MessageFeedbackRepository(resources.database),
    notificationsRepository:
      options.notificationsRepository ?? new SessionNotificationsRepository(resources.database),
    onDraftError: (error) => resources.log?.warn({ err: error }, 'Could not reclaim prepared Session'),
  });
}
/**
 * Publishes one session aggregate and preserves catalog invalidation semantics.
 */
const plugin: FastifyPluginCallback = (server, _options, done) => {
  const service = createSessionsService(
    { database: server.database, sessionRuntime: server.sessionRuntime, log: server.log },
    {
      sessionsRepository: new SessionsRepository(server.database, (workspaceId, removed) => {
        server.dataEvents.publish({ resource: 'sessions', workspaceId });
        if (removed) {
          server.dataEvents.publish({ resource: 'notifications', workspaceId });
        }
      }),
      notificationsRepository: new SessionNotificationsRepository(server.database, (workspaceId) => {
        server.dataEvents.publish({ resource: 'sessions', workspaceId });
        server.dataEvents.publish({ resource: 'notifications', workspaceId });
      }),
      workspaceService: server.workspacesService,
      listMessageAttachments: (sessionId) => server.attachmentsService.listMessageAttachments(sessionId),
      refreshConfiguration: () => server.modelConfigMonitor.refresh(),
      modelSettings: server.settingsService,
    }
  );
  server.decorate('sessionsService', service);
  const unsubscribeControl = server.sessionRuntime.onControlChanged(() =>
    server.dataEvents.publish({ resource: 'sessions' })
  );
  const unsubscribeCatalog = server.sessionRuntime.onEvent((event) => {
    if (event.type === 'runtime-state') {
      server.dataEvents.publish({ resource: 'sessions', workspaceId: event.workspaceId });
    }
  });
  server.addHook('onClose', async () => {
    unsubscribeCatalog();
    unsubscribeControl();
    await service.closeDrafts();
    service.dispose();
  });
  registerSessionErrorMessages();
  server.register(
    (scope, _options, complete) => {
      registerSessionsController(scope, service);
      registerSessionDraftsController(scope, service);
      registerSessionNotificationsController(scope, service.notifications, service);
      complete();
    },
    { prefix: '/api' }
  );
  done();
};
export default fp(plugin, {
  name: 'sessions',
  fastify: '5.x',
  dependencies: ['attachments', 'model-settings', 'workspaces'],
  decorators: { fastify: ['sessionRuntime', 'database'] },
});
