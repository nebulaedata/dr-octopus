/**
 * @author Codex
 * @description Registers local provider creation, discovery and configuration endpoints.
 * - GET /api/settings/local-runtimes
 * - POST /api/settings/local-providers
 * - POST /api/settings/model-providers/:providerKey/local/detect
 * - PUT /api/settings/model-providers/:providerKey/local
 */
import {
  CreateLocalProviderBodySchema,
  DetectLocalProviderBodySchema,
  ConfigureLocalProviderBodySchema,
} from '@octopus/shared/protocol';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { MutationIdempotencyLedger, mutationFingerprint } from '../../lib/idempotency/mutation-ledger.js';
import type { FastifyInstance } from 'fastify';
import type { SettingsService } from './settings.service.js';

/**
 * Validates bodies and ensures retried creation requests cannot duplicate providers.
 */
export function registerLocalProviderController(server: FastifyInstance, service: SettingsService): void {
  const ledger = new MutationIdempotencyLedger();
  server.get('/settings/local-runtimes', () => service.getLocalRuntimes());
  server.post('/settings/local-providers', async (request, reply) => {
    const body = CreateLocalProviderBodySchema.safeParse(request.body);
    const key = request.headers['idempotency-key'];
    if (!body.success || typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {throw invalidRequest();}
    const result = await ledger.execute(
      {
        scope: 'local-providers',
        key,
        type: 'create-local-provider',
        fingerprint: mutationFingerprint(body.data),
      },
      () => service.createLocalProvider(body.data)
    );
    return reply.status(201).send(result);
  });
  server.post<{ Params: { providerKey: string } }>(
    '/settings/model-providers/:providerKey/local/detect',
    (request) => {
      const body = DetectLocalProviderBodySchema.safeParse(request.body);
      if (!body.success) {throw invalidRequest();}
      return service.detectLocalProvider(request.params.providerKey, body.data.baseUrl);
    }
  );
  server.put<{ Params: { providerKey: string } }>(
    '/settings/model-providers/:providerKey/local',
    (request) => {
      const body = ConfigureLocalProviderBodySchema.safeParse(request.body);
      if (!body.success) {throw invalidRequest();}
      return service.configureLocalProvider(request.params.providerKey, body.data);
    }
  );
}
/**
 * Returns a stable validation failure without echoing request data.
 */
function invalidRequest() {
  return new ApplicationError(
    'INVALID_SETTINGS_REQUEST',
    '本地提供商配置无效，请检查名称、服务地址和模型。',
    { statusCode: 400 }
  );
}
