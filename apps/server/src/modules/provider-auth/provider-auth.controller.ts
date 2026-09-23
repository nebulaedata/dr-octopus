/**
 * @author Codex
 * @description Registers Provider authentication and preserves HTTP idempotency contracts.
 * DELETE /api/settings/model-providers/:providerKey/auth
 * POST /api/settings/model-providers/:providerKey/auth-sessions
 * GET /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId
 * POST /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId/answers
 * DELETE /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId
 */
import {
  AnswerProviderAuthPromptBodySchema,
  CreateProviderAuthSessionBodySchema,
} from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import {
  MutationIdempotencyLedger,
  mutationFingerprint,
} from '../../infrastructure/idempotency/mutation-ledger.js';
import type { AnswerProviderAuthPromptBody, CreateProviderAuthSessionBody } from '@octopus/shared/protocol';
import type { FastifyInstance } from 'fastify';
import type { ProviderAuthService } from './provider-auth.service.js';
interface ProviderParams {
  providerKey: string;
}
interface ProviderAuthSessionParams extends ProviderParams {
  authSessionId: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/**
 * Isolates the authentication mutation ledger within its route scope.
 */
export function registerProviderAuthController(server: FastifyInstance, service: ProviderAuthService): void {
  const mutations = new MutationIdempotencyLedger();

  server.delete<{ Params: ProviderParams }>(
    '/settings/model-providers/:providerKey/auth',
    async (request, reply) => {
      const key = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await mutations.execute(
        {
          scope: request.params.providerKey,
          key,
          type: 'reset-provider-auth',
          fingerprint: mutationFingerprint({}),
        },
        () => service.resetProviderAuth(request.params.providerKey)
      );
      return reply.status(200).send(result);
    }
  );

  server.post<{ Params: ProviderParams; Body: CreateProviderAuthSessionBody }>(
    '/settings/model-providers/:providerKey/auth-sessions',
    async (request, reply) => {
      const body = CreateProviderAuthSessionBodySchema.safeParse(request.body);
      if (!body.success) {
        throw invalidSettingsRequest('The authentication method is malformed.');
      }
      const key = requireIdempotencyKey(request.headers['idempotency-key']);
      const snapshot = await mutations.execute(
        {
          scope: request.params.providerKey,
          key,
          type: 'create-provider-auth-session',
          fingerprint: mutationFingerprint(body.data),
        },
        () => service.createProviderAuthSession(request.params.providerKey, body.data.type)
      );
      return reply.status(202).send(snapshot);
    }
  );

  server.get<{ Params: ProviderAuthSessionParams }>(
    '/settings/model-providers/:providerKey/auth-sessions/:authSessionId',
    (request) => service.getProviderAuthSession(request.params.providerKey, request.params.authSessionId)
  );

  server.post<{ Params: ProviderAuthSessionParams; Body: AnswerProviderAuthPromptBody }>(
    '/settings/model-providers/:providerKey/auth-sessions/:authSessionId/answers',
    (request, reply) => {
      const body = AnswerProviderAuthPromptBodySchema.safeParse(request.body);
      if (!body.success) {
        throw invalidSettingsRequest('The authentication answer is malformed.');
      }
      return reply
        .status(202)
        .send(
          service.answerProviderAuthPrompt(
            request.params.providerKey,
            request.params.authSessionId,
            body.data.promptId,
            body.data.answer
          )
        );
    }
  );

  server.delete<{ Params: ProviderAuthSessionParams }>(
    '/settings/model-providers/:providerKey/auth-sessions/:authSessionId',
    async (request, reply) => {
      const key = requireIdempotencyKey(request.headers['idempotency-key']);
      const snapshot = await mutations.execute(
        {
          scope: `${request.params.providerKey}:${request.params.authSessionId}`,
          key,
          type: 'cancel-provider-auth-session',
          fingerprint: mutationFingerprint({}),
        },
        () =>
          Promise.resolve(
            service.cancelProviderAuthSession(request.params.providerKey, request.params.authSessionId)
          )
      );
      return snapshot === undefined ? reply.status(204).send() : reply.status(202).send(snapshot);
    }
  );
}
/**
 * Requires the UUID idempotency identity used by Settings mutations.
 */
function requireIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw invalidSettingsRequest('Idempotency-Key must be a UUID.');
  }
  return value;
}

/**
 * Creates a stable Settings request validation error.
 */
function invalidSettingsRequest(message: string): ApplicationError {
  return new ApplicationError('INVALID_SETTINGS_REQUEST', message, { statusCode: 400 });
}
