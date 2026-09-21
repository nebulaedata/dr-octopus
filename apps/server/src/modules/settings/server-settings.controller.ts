/**
 * @author Codex
 * @description Exposes Server settings and hands accepted restarts to the Host after response completion.
 * GET /api/settings/server
 * PATCH /api/settings/server
 * POST /api/settings/server/restart
 * GET /api/settings/server/restart-operations/:operationId
 */
import { RestartKeySchema, RestartServerSchema, UpdateServerSettingsSchema } from '@octopus/shared/protocol';
import { controlError } from '../../lib/lifecycle/control.js';
import type { ServerControl } from '../../lib/lifecycle/control.js';
import type { ServerSettingsService } from './server-settings.service.js';
import type { FastifyInstance } from 'fastify';

/**
 * Validates every mutation and leaves lifecycle ownership outside Fastify.
 */
export function registerServerSettingsController(
  server: FastifyInstance,
  service: ServerSettingsService,
  control: ServerControl
): void {
  server.register(
    (scope, _options, done) => {
      scope.addHook('onRequest', async (request, reply) => {
        reply.header('Cache-Control', 'no-store').header('X-Request-Id', request.id);
      });
      scope.get('', () => service.get());
      scope.patch('', (request) => {
        const parsed = UpdateServerSettingsSchema.safeParse(request.body);
        if (!parsed.success) {
          throw controlError('INVALID_SERVER_SETTINGS_REQUEST', 'Invalid Server settings.', 400);
        }
        return service.update(parsed.data, request.headers['x-octopus-confirm-exposure'] === 'true');
      });
      scope.post('/restart', async (request, reply) => {
        const body = RestartServerSchema.safeParse(request.body);
        const key = RestartKeySchema.safeParse(request.headers['idempotency-key']);
        if (!body.success || !key.success) {
          throw controlError(
            'INVALID_SERVER_SETTINGS_REQUEST',
            'Invalid restart request or idempotency key.',
            400
          );
        }
        if (!control.restart) {
          throw controlError('SERVER_RESTART_UNSUPPORTED', 'Restart is managed by the embedding Host.', 501);
        }
        const accepted = await control.restart(body.data, key.data);
        reply.raw.once('finish', accepted.handoff);
        reply.raw.once('close', accepted.handoff);
        return reply.code(202).send({ operation: accepted.operation, outcome: 'accepted', warnings: [] });
      });
      scope.get<{ Params: { operationId: string } }>('/restart-operations/:operationId', (request) => {
        if (!control.operation) {
          throw controlError('SERVER_RESTART_OPERATION_NOT_FOUND', 'Restart result is unknown.', 404);
        }
        return { operation: control.operation(request.params.operationId) };
      });
      done();
    },
    { prefix: '/settings/server' }
  );
}
