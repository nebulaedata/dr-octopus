/**
 * @author Codex
 * @description Composes application Services, HTTP route Modules, and realtime transport without owning infrastructure lifecycle.
 */

import { createWorkspaceService, subscribeSchedulerChanges } from '@octopus/agent';
import { DataEventsService } from './data-events/data-events.service.js';
import { MemoryService } from './memory/memory.service.js';
import { registerMemoryController } from './memory/memory.controller.js';
import { registerMemoryErrorMessages } from './memory/memory.i18n.js';
import { KnowledgeService } from './knowledge/knowledge.service.js';
import { registerKnowledgeController } from './knowledge/knowledge.controller.js';
import { KnowledgeUploadStore } from './knowledge/knowledge-upload-store.js';
import { registerKnowledgeUploads } from './knowledge/knowledge-upload.controller.js';
import { registerKnowledgeMcpController } from './knowledge/knowledge-mcp.controller.js';
import { createKnowledgeAttachmentContext } from './knowledge/knowledge-attachments.js';
import { registerKnowledgeErrorMessages } from './knowledge/knowledge.i18n.js';
import { registerSessionErrorMessages } from './sessions/sessions.i18n.js';
import { registerSettingsErrorMessages } from './settings/settings.i18n.js';
import { registerAttachmentErrorMessages } from './attachments/attachments.i18n.js';
import { registerDataEventsController } from './data-events/data-events.controller.js';
import { SessionsRepository } from './sessions/sessions.repository.js';
import { join } from 'node:path';
import websocket from '@fastify/websocket';
import { AttachmentsService } from './attachments/attachments.service.js';
import { ChannelService } from './channel/channel.service.js';
import { isAllowedOrigin } from './channel/channel.utils.js';
import { registerAttachmentsController } from './attachments/attachments.controller.js';
import { registerHealthController } from './health/health.controller.js';
import { registerChannelController } from './channel/channel.controller.js';
import { registerSessionDraftsController } from './sessions/session-drafts.controller.js';
import { registerSessionsController } from './sessions/sessions.controller.js';
import { registerSkillsController } from './skills/skills.controller.js';
import { registerWorkspacesController } from './workspaces/workspaces.controller.js';
import { registerSettingsController } from './settings/settings.controller.js';
import { registerMcpSettingsController } from './settings/mcp-settings.controller.js';
import { EffectiveSkillsService } from './skills/effective-skills.service.js';
import { SessionsService } from './sessions/sessions.service.js';
import { SessionNotificationsRepository } from './sessions/session-notifications.repository.js';
import { registerSessionNotificationsController } from './sessions/session-notifications.controller.js';
import { subscribeSessionCompletionNotices } from './sessions/session-completion-notices.js';
import { ScheduledTasksService } from './scheduled-tasks/scheduled-tasks.service.js';
import { ScheduledResultsService } from './scheduled-tasks/scheduled-results.service.js';
import { registerScheduledResultsController } from './scheduled-tasks/scheduled-results.controller.js';
import { registerScheduledTasksController } from './scheduled-tasks/scheduled-tasks.controller.js';
import { SkillsService } from './skills/skills.service.js';
import { WorkspacesService } from './workspaces/workspaces.service.js';
import { SettingsService } from './settings/settings.service.js';
import { createModelConfigChanges } from './settings/model-config-changes.js';
import { McpSettingsService } from './settings/mcp-settings.service.js';
import { PermissionSettingsService } from './settings/permission-settings.service.js';
import { registerPermissionSettingsController } from './settings/permission-settings.controller.js';
import { EnvironmentSettingsService } from './settings/environment-settings.service.js';
import { ServerConfiguration } from './settings/server-configuration.js';
import { ServerSettingsService } from './settings/server-settings.service.js';
import { registerServerSettingsController } from './settings/server-settings.controller.js';
import { registerEnvironmentSettingsController } from './settings/environment-settings.controller.js';
import { createPiSettingsStore } from '../lib/pi-settings/index.js';
import { createPiMcpStore } from '../lib/pi-mcp/index.js';
import { resolveServerPaths } from '../lib/config/server-paths.js';
import type { SchedulerChangeSubscription } from '@octopus/agent';
import type { ServerControl } from '../lib/lifecycle/control.js';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { ServerConfig } from '../lib/config/utils.js';
import type { CapabilityLimits } from './health/health.controller.js';
import type { ServerPaths } from '../lib/config/server-paths.js';

export interface HttpModuleDependencies {
  sessionsService: SessionsService;
  attachmentsService: AttachmentsService;
  workspacesService: WorkspacesService;
  skillsService: SkillsService;
  effectiveSkillsService: EffectiveSkillsService;
  settingsService: SettingsService;
  mcpSettingsService: McpSettingsService;
}

export interface WSModuleDependencies {
  sessionChannelService: ChannelService;
  options: {
    maxWebSocketMessageBytes: number;
    allowOrigin: string[] | ((origin: string) => boolean);
  };
}

export interface ApplicationModulesOptions {
  control: ServerControl;
  config: ServerConfig;
  storagePaths?: ServerPaths;
  allowOrigin: string[] | ((origin: string) => boolean);
}

const HTTP_BASE_URL = '/api';
const MAX_PROMPT_CHARACTERS = 100_000;
const MAX_WS_MESSAGE_BYTES = 512 * 1024;
const MAX_SUBSCRIPTIONS = 32;

/**
 * Composes business Services after infrastructure plugins have published their process-local dependencies.
 */
export const registerApplicationModules: FastifyPluginCallback<ApplicationModulesOptions> = (
  server,
  options,
  done
) => {
  const dataEvents = new DataEventsService();
  // Services
  const workspacesService = new WorkspacesService(server, {
    workspaceBackend: createWorkspaceService(),
  });
  const attachmentsService = new AttachmentsService(server, {
    maxBytes: options.config.attachmentLimitBytes,
    ...(options.storagePaths === undefined
      ? {}
      : {
          dataRoot: options.storagePaths.attachmentsRoot,
          backupRoot: options.storagePaths.backupsRoot,
        }),
  });
  const skillsService = new SkillsService(server, {
    workspaceService: workspacesService,
    skillsRoot: join(options.config.agentDir, 'skills'),
  });
  registerKnowledgeMcpController(server, options.config.agentDir);
  const effectiveSkillsService = new EffectiveSkillsService(server, {
    workspaceService: workspacesService,
    agentDir: options.config.agentDir,
  });
  const sessionsService = new SessionsService(server, {
    sessionsRepository: new SessionsRepository(server.database, (workspaceId, removed) => {
      dataEvents.publish({ resource: 'sessions', workspaceId });
      if (removed) {
        dataEvents.publish({ resource: 'notifications', workspaceId });
      }
    }),
    workspaceService: workspacesService,
    listMessageAttachments: (sessionId) => attachmentsService.listMessageAttachments(sessionId),
  });
  const settingsService = new SettingsService(
    createPiSettingsStore({ agentDir: options.config.agentDir }),
    createModelConfigChanges(server.sessionRuntime.configChanges)
  );
  const unsubscribeControl = server.sessionRuntime.onControlChanged(() => {
    dataEvents.publish({ resource: 'sessions' });
  });
  const notices = new SessionNotificationsRepository(server.database, (workspaceId) => {
    dataEvents.publish({ resource: 'sessions', workspaceId });
    dataEvents.publish({ resource: 'notifications', workspaceId });
  });
  const unsubscribeCatalog = server.sessionRuntime.onEvent((event) => {
    if (event.type === 'runtime-state') {
      dataEvents.publish({ resource: 'sessions', workspaceId: event.workspaceId });
    }
  });
  const mcpSettingsService = new McpSettingsService(createPiMcpStore({ agentDir: options.config.agentDir }));
  const sessionChannelService = new ChannelService(
    server,
    {
      sessionsService,
      attachmentsService,
      prepareKnowledgeAttachments: createKnowledgeAttachmentContext(
        options.config.agentDir,
        attachmentsService,
        sessionsService
      ),
      resolveWorkspaceCwd: async (workspaceId) => (await workspacesService.resolve({ id: workspaceId })).cwd,
      resolveWorkspaceReferences: (workspaceId, references) =>
        workspacesService.resolveReferences(workspaceId, references),
    },
    { maxSubscriptions: MAX_SUBSCRIPTIONS }
  );

  const unsubscribeNotices = subscribeSessionCompletionNotices(
    sessionsService,
    notices,
    (err) => server.log.error({ err }, 'Session notification publication failed'),
    (sessionId) => sessionChannelService.isSessionFocused(sessionId)
  );

  const scheduler: ScheduledTasksService = new ScheduledTasksService({
    agentDir: options.config.agentDir,
    workspaces: workspacesService,
    sessions: sessionsService,
    onPurged: (workspaceId, taskId) => scheduledResults.purgeTask(workspaceId, taskId),
  });
  const scheduledResults = new ScheduledResultsService(
    scheduler,
    sessionsService,
    notices,
    workspacesService,
    join((options.storagePaths ?? resolveServerPaths()).stateRoot, 'scheduler-reports'),
    (err) => server.log.warn({ err }, 'Scheduler result synchronization failed')
  );
  let schedulerSubscription: SchedulerChangeSubscription | undefined;
  server.addHook('onReady', (done) => {
    scheduledResults.start();
    schedulerSubscription = subscribeSchedulerChanges(options.config.agentDir, () => {
      dataEvents.publish({ resource: 'scheduler' });
      scheduledResults.requestSync();
    });
    done();
  });
  server.addHook('preClose', async () => {
    await schedulerSubscription?.close();
    await scheduledResults.close();
    scheduler.close();
  });

  const maxAttachmentsPerMessage = 10;

  // Registers
  server.register(
    (server, _options, registerDone) => {
      registerHttpModules(
        server,
        {
          sessionsService,
          attachmentsService,
          workspacesService,
          skillsService,
          effectiveSkillsService,
          settingsService,
          mcpSettingsService,
        },
        {
          maxAttachmentBytes: attachmentsService.maxBytes,
          maxAttachmentsPerMessage,
          maxAttachmentMessageBytes: attachmentsService.maxBytes * maxAttachmentsPerMessage,
          tusChunkBytes: 8 * 1024 * 1024,
          maxPromptCharacters: MAX_PROMPT_CHARACTERS,
          maxSubscriptionsPerConnection: MAX_SUBSCRIPTIONS,
          maxWebSocketMessageBytes: MAX_WS_MESSAGE_BYTES,
        }
      );
      registerDataEventsController(server, dataEvents, options.allowOrigin);
      registerMemoryController(server, new MemoryService(server));
      registerMemoryErrorMessages();
      const knowledgeService = new KnowledgeService(options.config.agentDir, workspacesService);
      registerKnowledgeErrorMessages();
      const knowledgeUploads = new KnowledgeUploadStore(
        server.database,
        join((options.storagePaths ?? resolveServerPaths()).stateRoot, 'knowledge-uploads'),
        knowledgeService
      );
      registerKnowledgeController(server, knowledgeService);
      registerKnowledgeUploads(server, knowledgeUploads, workspacesService);
      let uploadCleanup: Promise<unknown> = Promise.resolve();
      const uploadTimer = setInterval(() => {
        uploadCleanup = uploadCleanup
          .then(() => knowledgeUploads.deleteExpired())
          .catch((error: unknown) => server.log.warn({ err: error }, 'Knowledge upload cleanup failed'));
      }, 60_000);
      uploadTimer.unref();
      server.addHook('preClose', async () => {
        clearInterval(uploadTimer);
        await uploadCleanup;
        await knowledgeUploads.close();
      });
      registerPermissionSettingsController(
        server,
        new PermissionSettingsService(options.config.agentDir, workspacesService)
      );
      registerSettingsErrorMessages();
      const configuration = new ServerConfiguration(options.config.paths.dataDir, options.control);
      registerServerSettingsController(
        server,
        new ServerSettingsService(options.config, configuration, options.control, () => ({
          state: options.control.state(),
          address: server.listeningOrigin ?? null,
          activeRuntimeCount: server.sessionRuntime.getDiagnostics().activeRuntimeCount,
          fileLogging: {
            enabled: options.config.fileLogging.enabled,
            state: server.logging.getHealth().state,
            directory: options.config.paths.logsRoot,
          },
        })),
        options.control
      );
      registerEnvironmentSettingsController(
        server,
        new EnvironmentSettingsService(
          options.config.paths.dataDir,
          options.config.agentDir,
          undefined,
          configuration
        )
      );
      server.addHook('onResponse', (request, reply, next) => {
        if (request.method !== 'GET' && reply.statusCode < 400 && request.url.includes('/scheduler')) {
          dataEvents.publish({ resource: 'scheduler' });
          scheduledResults.requestSync();
        }
        next();
      });
      registerScheduledTasksController(server, scheduler);
      registerSessionNotificationsController(server, notices, sessionsService);
      registerScheduledResultsController(server, scheduledResults);
      registerDone();
    },
    { prefix: HTTP_BASE_URL }
  );

  registerWsModules(server, {
    sessionChannelService,
    options: {
      maxWebSocketMessageBytes: MAX_WS_MESSAGE_BYTES,
      allowOrigin: options.allowOrigin,
    },
  });

  server.addHook('onClose', async () => {
    unsubscribeNotices();
    unsubscribeCatalog();
    unsubscribeControl();
    await attachmentsService.close();
    await settingsService.close();
    await sessionsService.closeDrafts();
    sessionsService.dispose();
  });
  void attachmentsService.ready().then(() => done(), done);
};

/**
 * Registers each HTTP resource Module at the application composition seam.
 */
export function registerHttpModules(
  server: FastifyInstance,
  dependencies: HttpModuleDependencies,
  capabilityLimits: CapabilityLimits
): void {
  registerHealthController(server, capabilityLimits);
  registerWorkspacesController(server, dependencies.workspacesService);
  registerSessionsController(server, dependencies.sessionsService);
  registerSessionErrorMessages();
  registerSessionDraftsController(server, dependencies.sessionsService);
  server.register((attachmentScope, _options, done) => {
    registerAttachmentsController(
      attachmentScope,
      dependencies.attachmentsService,
      dependencies.workspacesService
    );
    done();
  });
  registerAttachmentErrorMessages();
  registerSkillsController(server, dependencies.skillsService, dependencies.effectiveSkillsService);
  registerSettingsController(server, dependencies.settingsService);
  registerMcpSettingsController(server, dependencies.mcpSettingsService);
}

/**
 * Registers the WebSocket transport and the Session channel Module at the application composition seam.
 */
export function registerWsModules(server: FastifyInstance, dependencies: WSModuleDependencies): void {
  const { maxWebSocketMessageBytes, allowOrigin } = dependencies.options;

  /**
   * Installs the WebSocket interception hook before declaring its encapsulated route.
   */
  server.register(async (wsServer) => {
    await wsServer.register(websocket, {
      options: {
        maxPayload: maxWebSocketMessageBytes,
        verifyClient(info, callback) {
          if (
            isAllowedOrigin(info.origin, allowOrigin, {
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
    registerChannelController(wsServer, dependencies.sessionChannelService);
  });
}
