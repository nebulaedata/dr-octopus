/**
 * @author Codex
 * @description Exposes scoped scheduled-task management through the public control-plane API.
 * GET /api/scheduler/service
 * POST /api/scheduler/service/start
 * POST /api/scheduler/service/stop
 * POST /api/scheduler/service/restart
 * GET /api/scheduler/settings
 * PUT /api/scheduler/settings
 * GET /api/workspaces/:workspaceId/scheduled-tasks
 * GET /api/workspaces/:workspaceId/scheduled-tasks/history
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/archive
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/restore
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/purge
 * GET /api/scheduled-tasks
 * GET /api/scheduled-tasks/history
 * GET /api/workspaces/:workspaceId/scheduled-tasks/:taskId
 * PATCH /api/workspaces/:workspaceId/scheduled-tasks/:taskId
 * DELETE /api/workspaces/:workspaceId/scheduled-tasks/:taskId
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/runs
 * GET /api/workspaces/:workspaceId/scheduled-tasks/:taskId/runs
 * GET /api/workspaces/:workspaceId/scheduled-tasks/:taskId/runs/:runId/transcript
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/cancel
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/authorization-preview
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/authorize
 * POST /api/workspaces/:workspaceId/scheduled-tasks/:taskId/revoke-authorization
 */

import { z } from 'zod';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type { ScheduledTasksService, SchedulerOperation } from './scheduled-tasks.service.js';
import type { ScheduledResultSynchronization } from './scheduled-tasks.service.js';

interface Params {
  workspaceId: string;
  taskId?: string;
  runId?: string;
}

/**
 * Maps HTTP headers and paths to domain operations without owning schedule or persistence logic.
 */
export function registerScheduledTasksController(
  server: FastifyInstance,
  service: ScheduledTasksService
): void {
  server.get('/scheduler/service', async (_request, reply) => reply.send(await service.status()));
  for (const action of ['start', 'stop', 'restart'] as const) {
    server.post(`/scheduler/service/${action}`, async (_request, reply) =>
      reply.send(await service.control(action))
    );
  }
  server.get('/scheduler/settings', async (_request, reply) => reply.send(await service.settings()));
  server.put('/scheduler/settings', async (request, reply) => {
    const result = await service.updateSettings(request.body);
    reply.header('ETag', `"${result.revision}"`);
    return reply.send(result);
  });
  const base = '/workspaces/:workspaceId/scheduled-tasks';
  server.get('/scheduled-tasks', async (request, reply) => reply.send(await service.catalog(request.query)));
  server.get('/scheduled-tasks/history', async (request, reply) =>
    reply.send(await service.historyCatalog(request.query))
  );
  server.get<{ Params: Params }>(base, async (request, reply) =>
    reply.send(await service.list({ workspaceId: request.params.workspaceId }, request.query))
  );
  server.get<{ Params: Params }>(`${base}/history`, async (request, reply) =>
    reply.send(await service.history({ workspaceId: request.params.workspaceId }, '', request.query))
  );
  server.get<{ Params: Params }>(`${base}/:taskId`, async (request, reply) => {
    const task = await service.get({ workspaceId: request.params.workspaceId }, request.params.taskId!);
    reply.header('ETag', `"${task.revision}"`);
    return task;
  });
  server.get<{ Params: Params }>(`${base}/:taskId/runs`, async (request, reply) =>
    reply.send(
      await service.history(
        { workspaceId: request.params.workspaceId },
        request.params.taskId!,
        request.query
      )
    )
  );
  server.get<{ Params: Params }>(`${base}/:taskId/runs/:runId/transcript`, async (request, reply) =>
    reply.send(
      await service.transcript(
        { workspaceId: request.params.workspaceId },
        request.params.taskId!,
        request.params.runId!
      )
    )
  );
  server.post<{ Params: Params }>(`${base}/:taskId/authorization-preview`, async (request, reply) =>
    reply.send(
      await service.authorizationPreview({ workspaceId: request.params.workspaceId }, request.params.taskId!)
    )
  );
  const routes: { method: 'POST' | 'PATCH' | 'DELETE'; url: string; operation: SchedulerOperation }[] = [
    { method: 'POST', url: `${base}/:taskId/authorize`, operation: 'authorize' },
    { method: 'POST', url: `${base}/:taskId/revoke-authorization`, operation: 'revoke-authorization' },
    { method: 'PATCH', url: `${base}/:taskId`, operation: 'update' },
    { method: 'DELETE', url: `${base}/:taskId`, operation: 'delete' },
    { method: 'POST', url: `${base}/:taskId/archive`, operation: 'delete' },
    { method: 'POST', url: `${base}/:taskId/restore`, operation: 'restore' },
    { method: 'POST', url: `${base}/:taskId/purge`, operation: 'purge' },
    { method: 'POST', url: `${base}/:taskId/runs`, operation: 'run-now' },
    { method: 'POST', url: `${base}/:taskId/cancel`, operation: 'cancel' },
  ];
  for (const route of routes) {
    server.route<{ Params: Params }>({
      method: route.method,
      url: route.url,
      bodyLimit: 512 * 1024,
      async handler(request, reply) {
        const key = request.headers['idempotency-key'];
        const match = request.headers['if-match'];
        const revisionText = typeof match === 'string' ? /^(?:"([1-9]\d*)"|([1-9]\d*))$/.exec(match) : null;
        const result = await service.mutate(
          { workspaceId: request.params.workspaceId },
          {
            operation: route.operation,
            key: typeof key === 'string' ? key : '',
            ...(request.params.taskId ? { taskId: request.params.taskId } : {}),
            ...(revisionText ? { revision: Number(revisionText[1] ?? revisionText[2]) } : {}),
            input: request.body ?? {},
          }
        );
        reply.header('ETag', `"${result.task.revision}"`);
        return reply.status(route.operation === 'run-now' ? 202 : 200).send(result);
      },
    });
  }
}

/**
 * Map trusted identifiers to browser-safe Session links and bounded transcript pages.
 */
export function registerScheduledResultsController(
  server: FastifyInstance,
  results: ScheduledResultSynchronization
): void {
  server.get<{ Params: { workspaceId: string; taskId: string; runId: string } }>(
    '/workspaces/:workspaceId/scheduled-tasks/:taskId/runs/:runId/session',
    async ({ params }) => ({
      workspaceId: params.workspaceId,
      sessionId: await results.ensure(params.workspaceId, params.taskId, params.runId),
    })
  );
  server.get<{ Params: { workspaceId: string; sessionId: string } }>(
    '/workspaces/:workspaceId/sessions/:sessionId/execution',
    async ({ params, query }) => {
      const parsed = z
        .object({ offset: z.coerce.number().int().min(0).max(1_000_000).default(0) })
        .safeParse(query);
      if (!parsed.success) {
        throw new ApplicationError('SCHEDULE_INVALID', 'Invalid transcript page.', { statusCode: 400 });
      }
      return results.view(params.workspaceId, params.sessionId, parsed.data.offset);
    }
  );
}
