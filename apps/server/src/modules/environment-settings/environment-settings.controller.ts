/**
 * @author Codex
 * @description Registers scope-validated environment Settings endpoints with redacted responses.
 * - GET /api/settings/environment/:scope
 * - PATCH /api/settings/environment/:scope
 */
import { EnvironmentScopeSchema, UpdateEnvironmentBodySchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type { EnvironmentSettingsService } from './environment-settings.service.js';

/**
 * Exposes only the two configured stores; caller input never becomes a filesystem path.
 */
export function registerEnvironmentSettingsController(
  server: FastifyInstance,
  service: EnvironmentSettingsService
): void {
  server.get<{ Params: { scope: string } }>('/settings/environment/:scope', (request, reply) => {
    const scope = EnvironmentScopeSchema.safeParse(request.params.scope);
    if (!scope.success) {
      throw new ApplicationError('INVALID_ENVIRONMENT_SCOPE', 'Unknown environment scope.', {
        statusCode: 400,
      });
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Request-Id', request.id);
    return service.get(scope.data);
  });
  server.patch<{ Params: { scope: string } }>('/settings/environment/:scope', (request, reply) => {
    const scope = EnvironmentScopeSchema.safeParse(request.params.scope);
    const body = UpdateEnvironmentBodySchema.safeParse(request.body);
    if (!scope.success || !body.success) {
      throw new ApplicationError('INVALID_ENVIRONMENT_REQUEST', 'Invalid environment update.', {
        statusCode: 400,
      });
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Request-Id', request.id);
    return service.update(scope.data, body.data, request.headers['x-octopus-confirm-exposure'] === 'true');
  });
}
