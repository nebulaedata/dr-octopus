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

import { RestartSessionBodySchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import {
  MutationIdempotencyLedger,
  mutationFingerprint,
} from '../../infrastructure/idempotency/mutation-ledger.js';
import { z } from 'zod';
import { registerErrorMessages } from '../../infrastructure/i18n/error-catalog.js';
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

import type { ErrorMessageCatalog } from '../../infrastructure/i18n/error-catalog.js';

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

/**
 * Keep browser acknowledgement bounded by the version actually rendered.
 */
export function registerSessionNotificationsController(
  server: FastifyInstance,
  notices: SessionsService['notifications'],
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

/**
 * Session-domain message variants keyed by stable error code.
 */
export const sessionErrorMessages: ErrorMessageCatalog = {
  CONVERSATION_DELIVERY_UNKNOWN: {
    en: 'Delivery could not be confirmed. Inspect the conversation before sending again.',
    'zh-CN': '无法确认消息是否送达，请检查会话后再决定是否重新发送。',
  },
  CONVERSATION_PREPARATION_FAILED: {
    en: 'Conversation preparation did not complete. Check the model and selected work-mode settings, then retry your saved draft.',
    'zh-CN': '会话准备未完成，请检查模型和所选工作模式的配置后重试，草稿内容已保留。',
  },
  CONVERSATION_START_CONFLICT: {
    en: 'This submission conflicts with another saved request. Check its status before retrying.',
    'zh-CN': '提交与已保存的请求冲突，请先检查提交状态。',
  },
  CONVERSATION_MODEL_REQUIRED: {
    en: 'Choose an available model before sending.',
    'zh-CN': '请先配置并选择可用模型。',
  },
  CONVERSATION_START_CLOSED: {
    en: 'Conversation preparation is unavailable.',
    'zh-CN': '暂时无法准备会话。',
  },
  CONVERSATION_START_NOT_FOUND: {
    en: 'Conversation submission was not found.',
    'zh-CN': '未找到会话提交记录。',
  },
  CONVERSATION_START_INVALID: { en: 'Invalid conversation submission.', 'zh-CN': '会话提交内容无效。' },
  INVALID_RESTART_REQUEST: {
    en: 'The session restart request is invalid.',
    'zh-CN': '无效的会话重启请求。',
  },
  SESSION_CONFIGURATION_STALE: {
    en: 'Configuration changed. Apply the update before sending another message.',
    'zh-CN': '配置已变化，请应用更新后再发送新消息。',
  },
  SESSION_BUSY: {
    en: 'A task or interaction is still running; restarting will interrupt it.',
    'zh-CN': '当前任务或交互尚未结束，重启将中断任务。',
  },
  SESSION_NOT_FOUND: [
    { en: 'The session no longer exists.', 'zh-CN': '会话不存在或已删除。' },
    { match: '会话已删除。', en: 'The session was deleted.', 'zh-CN': '会话已删除。' },
  ],
  SESSION_RESTART_FAILED: [
    { en: 'The session restart failed; try again.', 'zh-CN': '会话重启失败，请重试。' },
    {
      match: '无法确认旧进程退出，会话已停止接受新任务。',
      en: 'The old process could not be confirmed stopped; the session no longer accepts new tasks.',
      'zh-CN': '无法确认旧进程退出，会话已停止接受新任务。',
    },
  ],
  SESSION_RESTART_IN_PROGRESS: {
    en: 'The session is restarting or stopping; try again later.',
    'zh-CN': '会话正在重启或停止，请稍后重试。',
  },
  SESSION_RESTART_UNSUPPORTED: {
    en: 'This session does not support restart.',
    'zh-CN': '此会话不支持重启。',
  },
  SESSION_RUNTIME_BINDING_MISMATCH: [
    { en: 'The runtime target is stale; refresh and try again.', 'zh-CN': '运行目标已过期，请刷新后重试。' },
    {
      match: '会话进程已变化，请刷新后重试。',
      en: 'The session process changed; refresh and try again.',
      'zh-CN': '会话进程已变化，请刷新后重试。',
    },
  ],
};

/**
 * Merges the session-domain catalog into the shared error-message registry at Server boot.
 */
export function registerSessionErrorMessages(): void {
  registerErrorMessages('sessions', sessionErrorMessages);
}
