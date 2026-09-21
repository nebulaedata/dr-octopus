/**
 * @author Codex
 * @description Exposes revision-checked permission Settings for global and registered workspace scopes.
 * - GET /api/settings/permissions
 * - PUT /api/settings/permissions
 */
import { z } from 'zod';
import { PermissionSettingsUpdateSchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type { PermissionSettingsService } from './permission-settings.service.js';

const querySchema = z.object({ workspaceId: z.string().min(1).max(200).optional() }).strict();

/**
 * Validate scope selectors and bodies before invoking configuration storage.
 */
export function registerPermissionSettingsController(
  server: FastifyInstance,
  service: PermissionSettingsService
): void {
  server.get('/settings/permissions', async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      throw new ApplicationError('INVALID_PERMISSION_SCOPE', '无效的权限配置范围', { statusCode: 400 });
    }
    reply.header('Cache-Control', 'no-store');
    return service.get(query.data.workspaceId);
  });
  server.put('/settings/permissions', async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    const body = PermissionSettingsUpdateSchema.safeParse(request.body);
    if (!query.success || !body.success) {
      throw new ApplicationError('INVALID_PERMISSION_CONFIG', '无效的权限配置请求', { statusCode: 400 });
    }
    reply.header('Cache-Control', 'no-store');
    return service.update(body.data, query.data.workspaceId);
  });
}
