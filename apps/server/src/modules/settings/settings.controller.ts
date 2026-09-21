/**
 * @author Codex
 * @description Registers Settings model, default-model, and Provider authentication endpoints.
 * - GET /api/settings/model-providers
 * - PUT /api/settings/model-providers/:providerKey/models/:modelKey/capabilities
 * - GET /api/settings/model-providers/:providerKey
 * - GET /api/settings/default-model
 * - GET /api/settings/default-model/candidates
 * - PUT /api/settings/default-model
 * - DELETE /api/settings/model-providers/:providerKey/auth
 * - POST /api/settings/model-providers/:providerKey/auth-sessions
 * - GET /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId
 * - POST /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId/answers
 * - DELETE /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId
 */

import {
  UpdateModelCapabilitiesBodySchema,
  AnswerProviderAuthPromptBodySchema,
  CreateProviderAuthSessionBodySchema,
  UpdateDefaultModelBodySchema,
} from '@octopus/shared/protocol';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { registerLocalProviderController } from './local-provider.controller.js';
import { MutationIdempotencyLedger, mutationFingerprint } from '../../lib/idempotency/mutation-ledger.js';
import type { FastifyInstance } from 'fastify';
import type {
  AnswerProviderAuthPromptBody,
  CreateProviderAuthSessionBody,
  UpdateDefaultModelBody,
} from '@octopus/shared/protocol';
import type { SettingsService } from './settings.service.js';

interface ProviderParams {
  providerKey: string;
}

interface ProviderAuthSessionParams extends ProviderParams {
  authSessionId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Registers Settings routes against one application service.
 *
 * @param server Fastify application receiving the routes.
 * @param service Settings application use cases.
 */
export function registerSettingsController(server: FastifyInstance, service: SettingsService): void {
  registerLocalProviderController(server, service);
  const mutations = new MutationIdempotencyLedger();
  server.get('/settings/model-providers', () => service.listProviders());

  server.get<{ Params: ProviderParams }>('/settings/model-providers/:providerKey', async (request, reply) => {
    const provider = await service.getProvider(request.params.providerKey);
    if (provider === undefined) {
      return reply.status(404).send({
        code: 'MODEL_PROVIDER_NOT_FOUND',
        message: 'The requested model provider does not exist.',
        requestId: request.id,
        retryable: false,
      });
    }
    return provider;
  });

  server.put<{ Params: ProviderParams & { modelKey: string } }>(
    '/settings/model-providers/:providerKey/models/:modelKey/capabilities',
    (request) => {
      const body = UpdateModelCapabilitiesBodySchema.safeParse(request.body);
      if (!body.success) {
        throw invalidSettingsRequest('The model capabilities are malformed.');
      }
      return service.updateModelCapabilities(request.params.providerKey, request.params.modelKey, body.data);
    }
  );

  server.get('/settings/default-model', () => service.getDefaultModel());
  server.get('/settings/default-model/candidates', () => service.listDefaultModelCandidates());
  server.put<{ Body: UpdateDefaultModelBody }>('/settings/default-model', (request, reply) => {
    const body = UpdateDefaultModelBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'INVALID_SETTINGS_REQUEST',
        message: 'The default-model selection is malformed.',
        requestId: request.id,
        retryable: false,
      });
    }
    return service.setDefaultModel(body.data.providerKey, body.data.modelKey);
  });

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
