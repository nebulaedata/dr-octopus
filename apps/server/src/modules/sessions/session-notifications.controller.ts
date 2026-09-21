/**
 * @author Codex
 * @description Exposes persisted completion notices and version-fenced Session read receipts.
 * - POST /api/notifications/read-all
 * - GET /api/notifications
 * - POST /api/workspaces/:workspaceId/sessions/:sessionId/read
 */
import { z } from 'zod';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type { SessionsService } from './sessions.service.js';
import type { SessionNotificationsRepository } from './session-notifications.repository.js';

/**
 * Keep browser acknowledgement bounded by the version actually rendered.
 */
export function registerSessionNotificationsController(
  server: FastifyInstance,
  notices: SessionNotificationsRepository,
  sessions: SessionsService
): void {
  server.get('/notifications', (request) => {
    const query = z
      .object({
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
        sessionId: z.string().min(1).optional(),
      })
      .safeParse(request.query);
    if (!query.success) {
      throw new ApplicationError('NOTIFICATION_INVALID', 'Invalid notification query.', { statusCode: 400 });
    }
    const items = notices.list(query.data.offset, query.data.sessionId);
    return { items: items.slice(0, 20), hasMore: items.length > 20, unreadCount: notices.unreadCount() };
  });
  server.post('/notifications/read-all', () => {
    notices.markAllRead();
    return { ok: true };
  });
  server.post<{ Params: { workspaceId: string; sessionId: string } }>(
    '/workspaces/:workspaceId/sessions/:sessionId/read',
    (request) => {
      const body = z
        .object({ version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
        .safeParse(request.body);
      if (!body.success) {
        throw new ApplicationError('NOTIFICATION_INVALID', 'Invalid read receipt.', { statusCode: 400 });
      }
      const session = sessions.getSession(request.params.sessionId);
      if (session.workspaceId !== request.params.workspaceId) {
        throw new ApplicationError('SESSION_NOT_FOUND', 'Session not found.', { statusCode: 404 });
      }
      notices.markRead(session.workspaceId, session.id, body.data.version);
      return { ok: true };
    }
  );
}
