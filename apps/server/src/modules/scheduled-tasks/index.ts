/**
 * @author Codex
 * @description Composes Scheduler operations and result synchronization within their shared task lifecycle.
 */
import fp from 'fastify-plugin';
import { join } from 'node:path';
import { resolveServerPaths } from '../../infrastructure/config/server-paths.js';
import { ScheduledTasksService, ScheduledResultSynchronization } from './scheduled-tasks.service.js';
import {
  registerScheduledTasksController,
  registerScheduledResultsController,
} from './scheduled-tasks.controller.js';
import { createResultSyncWorker } from './workers/result-sync.worker.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Preserves authoritative purge ordering and never owns the Agent scheduler daemon itself.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  const scheduler: ScheduledTasksService = new ScheduledTasksService({
    agentDir: options.config.agentDir,
    workspaces: server.workspacesService,
    sessions: server.sessionsService,
    onPurged: (workspaceId, taskId) => results.purgeTask(workspaceId, taskId),
  });
  const results = new ScheduledResultSynchronization(
    scheduler,
    server.sessionsService,
    server.sessionsService.notifications,
    server.workspacesService,
    join((options.storagePaths ?? resolveServerPaths()).stateRoot, 'scheduler-reports'),
    (err) => server.log.warn({ err }, 'Scheduler result synchronization failed')
  );
  const worker = createResultSyncWorker(options.config.agentDir, results, () =>
    server.dataEvents.publish({ resource: 'scheduler' })
  );
  server.addHook('onReady', (complete) => {
    worker.start();
    complete();
  });
  server.addHook('preClose', async () => {
    await worker.close();
    scheduler.close();
  });
  server.addHook('onResponse', (request, reply, next) => {
    if (request.method !== 'GET' && reply.statusCode < 400 && request.url.includes('/scheduler')) {
      server.dataEvents.publish({ resource: 'scheduler' });
      results.requestSync();
    }
    next();
  });
  registerScheduledTasksController(server, scheduler);
  registerScheduledResultsController(server, results);
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, {
  name: 'scheduled-tasks',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['sessions'],
});
