/**
 * @author Codex
 * @description Registers process-independent model discovery and durable conversation submission routes.
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/start-receipt
 * - GET /api/conversation-models
 * - POST /api/workspaces/:workspaceId/conversation-starts
 * - GET /api/workspaces/:workspaceId/conversation-starts/:submissionId
 * - DELETE /api/workspaces/:workspaceId/conversation-starts/:submissionId
 */

import { ConversationStartSchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { renderErrorMessage } from '../../infrastructure/i18n/error-catalog.js';
import { negotiateLocale } from '../../infrastructure/i18n/negotiate-locale.js';
import type { ConversationStartDto } from '@octopus/shared/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ConversationStartService } from './conversation-start.service.js';

/**
 * Translates stored failure categories at the HTTP boundary without changing durable state.
 */
function localize(value: ConversationStartDto | null, request: FastifyRequest) {
  if (!value?.error) {
    return value;
  }
  const code =
    value.status === 'unknown' ? 'CONVERSATION_DELIVERY_UNKNOWN' : 'CONVERSATION_PREPARATION_FAILED';
  return {
    ...value,
    error: renderErrorMessage(
      code,
      undefined,
      negotiateLocale(request.headers['accept-language']),
      value.error
    ),
  };
}

/**
 * Validates request bodies before claiming an operation; status remains scoped to its Workspace.
 */
export function registerConversationStartController(
  server: FastifyInstance,
  service: ConversationStartService
) {
  const path = '/workspaces/:workspaceId/conversation-starts';
  server.get('/conversation-models', () => service.catalog());
  server.get<{ Params: { workspaceId: string; sessionId: string } }>(
    '/workspaces/:workspaceId/sessions/:sessionId/start-receipt',
    (request) => localize(service.receipt(request.params.workspaceId, request.params.sessionId), request)
  );
  server.post<{ Params: { workspaceId: string } }>(path, async (request, reply) => {
    const body = ConversationStartSchema.safeParse(request.body);
    if (!body.success) {
      throw new ApplicationError('CONVERSATION_START_INVALID', 'Invalid conversation submission.', {
        statusCode: 400,
      });
    }
    return reply
      .code(202)
      .send(localize(await service.start(request.params.workspaceId, body.data), request));
  });
  server.get<{ Params: { workspaceId: string; submissionId: string } }>(`${path}/:submissionId`, (request) =>
    localize(service.get(request.params.workspaceId, request.params.submissionId), request)
  );
  server.delete<{ Params: { workspaceId: string; submissionId: string } }>(
    `${path}/:submissionId`,
    (request) => localize(service.cancel(request.params.workspaceId, request.params.submissionId), request)
  );
}
