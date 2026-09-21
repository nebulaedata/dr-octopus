/**
 * @author Codex
 * @description Registers browser-facing Session control routes.
 * - GET /api/workspaces/:workspaceId/sessions
 * - POST /api/workspaces/:workspaceId/sessions
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId
 * - PATCH /api/workspaces/:workspaceId/sessions/:sessionId
 * - PATCH /api/workspaces/:workspaceId/sessions/:sessionId/pinned
 * - DELETE /api/workspaces/:workspaceId/sessions/:sessionId
 * - POST /api/workspaces/:workspaceId/sessions/:sessionId/activate
 * - POST /api/workspaces/:workspaceId/sessions/:sessionId/restart
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/snapshot
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/bootstrap
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/entries
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/history
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/tree
 * - POST /api/workspaces/:workspaceId/sessions/:sessionId/fork
 * - POST /api/workspaces/:workspaceId/sessions/:sessionId/clone
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/stats
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/export
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/models
 * - GET /api/workspaces/:workspaceId/sessions/:sessionId/commands
 * - PATCH /api/workspaces/:workspaceId/sessions/:sessionId/preferences
 * - POST /api/workspaces/:workspaceId/sessions/:sessionId/feedback
 */

import { MutationIdempotencyLedger, mutationFingerprint } from '../../lib/idempotency/mutation-ledger.js';
import { RestartSessionBodySchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  CreateSessionBody,
  DeleteSessionBody,
  ForkSessionBody,
  ListSessionEntriesQuery,
  ListSessionsQuery,
  RenameSessionBody,
  SubmitMessageFeedbackBody,
  UpdateSessionPinnedBody,
  UpdateSessionPreferencesBody,
  WorkspaceParams,
  WorkspaceSessionParams,
} from './sessions.dto.js';
import type { SessionsService } from './sessions.service.js';

const SESSION_ROUTE = '/workspaces/:workspaceId/sessions/:sessionId';

/**
 * Registers Session routes behind the SessionsService application Interface.
 */
export function registerSessionsController(server: FastifyInstance, sessionsService: SessionsService): void {
  const mutations = new MutationIdempotencyLedger();
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/history`, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.getHistory(request.params.sessionId);
  });
  server.post<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/restart`, async (request) => {
    await assertScope(sessionsService, request.params);
    const parsed = RestartSessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApplicationError('INVALID_RESTART_REQUEST', '无效的会话重启请求。', { statusCode: 400 });
    }
    return executeHttpMutation(
      mutations,
      request,
      `session:${request.params.sessionId}`,
      'session.restart',
      parsed.data,
      () => sessionsService.restart(request.params.sessionId, parsed.data)
    );
  });
  server.get<{ Params: WorkspaceParams; Querystring: ListSessionsQuery }>(
    '/workspaces/:workspaceId/sessions',
    (request) => sessionsService.listSessions(request.params.workspaceId, request.query.search)
  );
  server.post<{ Params: WorkspaceParams; Body: CreateSessionBody }>(
    '/workspaces/:workspaceId/sessions',
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await executeHttpMutation(
            mutations,
            request,
            `workspace:${request.params.workspaceId}`,
            'session.create',
            request.body,
            () => sessionsService.createSession(request.params.workspaceId, request.body.title)
          )
        )
  );
  server.get<{ Params: WorkspaceSessionParams }>(SESSION_ROUTE, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.getSession(request.params.sessionId);
  });
  server.patch<{ Params: WorkspaceSessionParams; Body: RenameSessionBody }>(
    SESSION_ROUTE,
    async (request) => {
      await assertScope(sessionsService, request.params);
      return executeHttpMutation(
        mutations,
        request,
        `session:${request.params.sessionId}`,
        'session.rename',
        request.body,
        () => Promise.resolve(sessionsService.renameSession(request.params.sessionId, request.body.title))
      );
    }
  );
  server.patch<{ Params: WorkspaceSessionParams; Body: UpdateSessionPinnedBody }>(
    `${SESSION_ROUTE}/pinned`,
    async (request) => {
      await assertScope(sessionsService, request.params);
      return executeHttpMutation(
        mutations,
        request,
        `session:${request.params.sessionId}`,
        'session.pin',
        request.body,
        () => Promise.resolve(sessionsService.setSessionPinned(request.params.sessionId, request.body.pinned))
      );
    }
  );
  server.delete<{ Params: WorkspaceSessionParams; Body: DeleteSessionBody }>(
    SESSION_ROUTE,
    async (request, reply) => {
      await assertScope(sessionsService, request.params);
      const deleted = await executeHttpMutation(
        mutations,
        request,
        `session:${request.params.sessionId}`,
        'session.delete',
        request.body,
        () => sessionsService.deleteSession(request.params.sessionId, request.body)
      );
      return deleted
        ? reply.status(204).send()
        : reply.status(404).send({ code: 'SESSION_NOT_FOUND', message: 'Session was not found.' });
    }
  );
  server.post<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/activate`, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.activate(request.params.sessionId);
  });
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/snapshot`, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.getSnapshot(request.params.sessionId);
  });
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/bootstrap`, async (request) => {
    await assertScope(sessionsService, request.params);
    return withRequestSignal(request, (signal) =>
      sessionsService.getBootstrap(request.params.sessionId, { signal })
    );
  });
  server.get<{ Params: WorkspaceSessionParams; Querystring: ListSessionEntriesQuery }>(
    `${SESSION_ROUTE}/entries`,
    async (request) => {
      await assertScope(sessionsService, request.params);
      return sessionsService.getEntries(request.params.sessionId, request.query.since);
    }
  );
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/tree`, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.getTree(request.params.sessionId);
  });
  server.post<{ Params: WorkspaceSessionParams; Body: ForkSessionBody }>(
    `${SESSION_ROUTE}/fork`,
    async (request, reply) => {
      await assertScope(sessionsService, request.params);
      return reply
        .status(201)
        .send(
          await executeHttpMutation(
            mutations,
            request,
            `session:${request.params.sessionId}`,
            'session.fork',
            request.body,
            () => sessionsService.deriveSession(request.params.sessionId, 'fork', request.body.entryId)
          )
        );
    }
  );
  server.post<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/clone`, async (request, reply) => {
    await assertScope(sessionsService, request.params);
    return reply
      .status(201)
      .send(
        await executeHttpMutation(
          mutations,
          request,
          `session:${request.params.sessionId}`,
          'session.clone',
          {},
          () => sessionsService.deriveSession(request.params.sessionId, 'clone')
        )
      );
  });
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/stats`, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.execute(request.params.sessionId, { type: 'get_session_stats' });
  });
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/export`, async (request, reply) => {
    await assertScope(sessionsService, request.params);
    return reply
      .type('text/html; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${request.params.sessionId}.html"`)
      .send(await sessionsService.exportHtml(request.params.sessionId));
  });
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/models`, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.getModels(request.params.sessionId);
  });
  server.get<{ Params: WorkspaceSessionParams }>(`${SESSION_ROUTE}/commands`, async (request) => {
    await assertScope(sessionsService, request.params);
    return sessionsService.getCommands(request.params.sessionId);
  });
  server.patch<{ Params: WorkspaceSessionParams; Body: UpdateSessionPreferencesBody }>(
    `${SESSION_ROUTE}/preferences`,
    async (request) => {
      await assertScope(sessionsService, request.params);
      return executeHttpMutation(
        mutations,
        request,
        `session:${request.params.sessionId}`,
        'session.preferences',
        request.body,
        () => sessionsService.updatePreferences(request.params.sessionId, request.body)
      );
    }
  );
  server.post<{ Params: WorkspaceSessionParams; Body: SubmitMessageFeedbackBody }>(
    `${SESSION_ROUTE}/feedback`,
    async (request, reply) => {
      await assertScope(sessionsService, request.params);
      return reply
        .status(201)
        .send(
          await executeHttpMutation(
            mutations,
            request,
            `session:${request.params.sessionId}`,
            'session.feedback',
            request.body,
            () =>
              Promise.resolve(
                sessionsService.submitFeedback(
                  request.params.sessionId,
                  request.body.entryId,
                  request.body.rating
                )
              )
          )
        );
    }
  );
}

/**
 * Applies optional HTTP idempotency semantics while preserving backward compatibility for old clients.
 *
 * @param ledger Controller-scoped bounded mutation ledger.
 * @param request Active Fastify request carrying an optional Idempotency-Key header.
 * @param scope Stable Workspace or Session mutation scope.
 * @param type Stable mutation contract name.
 * @param input Mutation payload used for conflict detection.
 * @param operation Side effect executed at most once for the supplied key.
 * @returns First result or its replay.
 */
function executeHttpMutation<T>(
  ledger: MutationIdempotencyLedger,
  request: FastifyRequest,
  scope: string,
  type: string,
  input: unknown,
  operation: () => Promise<T>
): Promise<T> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.trim() === '') {
    return operation();
  }
  return ledger.execute({ scope, key: key.trim(), type, fingerprint: mutationFingerprint(input) }, operation);
}

/**
 * Propagates transport disconnects into Runtime caller cancellation without stopping shared activation.
 *
 * @param request Active Fastify request.
 * @param operation Session operation receiving the request lifetime signal.
 * @returns Operation result while the client remains connected.
 */
async function withRequestSignal<T>(
  request: FastifyRequest,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  request.raw.once('aborted', abort);
  try {
    return await operation(controller.signal);
  } finally {
    request.raw.removeListener('aborted', abort);
  }
}

/**
 * Enforces the Workspace parent before dispatching a child Session use case.
 */
async function assertScope(service: SessionsService, params: WorkspaceSessionParams): Promise<void> {
  await service.assertWorkspaceSession(params.workspaceId, params.sessionId);
}
