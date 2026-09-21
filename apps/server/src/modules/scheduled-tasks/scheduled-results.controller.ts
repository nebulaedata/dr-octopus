/**
 * @author Codex
 * @description Resolves execution links and serves readonly results without allocating runtimes.
 * - GET /api/workspaces/:workspaceId/scheduled-tasks/:taskId/runs/:runId/session
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/execution
 */
import { z } from 'zod';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type { ScheduledResultsService } from './scheduled-results.service.js';
/**
 * Map trusted identifiers to browser-safe Session links and bounded transcript pages.
 */
export function registerScheduledResultsController(
  server: FastifyInstance,
  results: ScheduledResultsService
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
