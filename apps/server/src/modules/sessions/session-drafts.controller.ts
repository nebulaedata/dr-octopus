/**
 * @author Codex
 * @description Exposes home draft prewarming and explicit first-prompt catalog publication.
 * - POST /api/workspaces/:workspaceId/session-drafts
 * - POST /api/workspaces/:workspaceId/session-drafts/:sessionId/publish
 */
import type { FastifyInstance } from 'fastify';
import type { SessionsService } from './sessions.service.js';
import type { WorkspaceParams, WorkspaceSessionParams } from './sessions.dto.js';

/**
 * Keeps draft preparation retry-safe through client-owned UUIDs and idempotent publication.
 */
export function registerSessionDraftsController(server: FastifyInstance, sessions: SessionsService): void {
  server.post<{ Params: WorkspaceParams; Body: { draftId: string } }>(
    '/workspaces/:workspaceId/session-drafts',
    async (request) => sessions.prepareDraftSession(request.params.workspaceId, request.body?.draftId ?? '')
  );
  server.post<{ Params: WorkspaceSessionParams; Body: { title: string } }>(
    '/workspaces/:workspaceId/session-drafts/:sessionId/publish',
    async (request) => {
      await sessions.assertWorkspaceSession(request.params.workspaceId, request.params.sessionId);
      return sessions.publishDraftSession(
        request.params.sessionId,
        typeof request.body?.title === 'string' ? request.body.title : 'New session'
      );
    }
  );
}
