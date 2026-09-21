/**
 * @author Codex
 * @description Knowledge management HTTP adapters; workspace authority comes exclusively from route parameters.
 * - GET/POST /api/knowledge/global/collections
 * - GET/POST /api/workspaces/:workspaceId/knowledge/collections
 * - PATCH/DELETE <knowledge-base>/collections/:id
 * - GET <knowledge-base>/collections/:id/documents
 * - DELETE <knowledge-base>/documents/:id
 * - POST <knowledge-base>/uploads
 * - POST <knowledge-base>/collections/:id/imports
 * - POST <knowledge-base>/collections/:id/reindex
 * - GET <knowledge-base>/jobs/:id
 * - POST <knowledge-base>/jobs/:id/cancel
 * - POST <knowledge-base>/search
 * - GET <knowledge-base>/evidence/:id
 * - GET/PUT /api/settings/knowledge/models
 * - GET /api/settings/knowledge/service/status
 * - GET /api/settings/knowledge/service/health
 * - POST /api/settings/knowledge/service/:action
 */
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type { KnowledgeOperations } from '@octopus/agent';
import type { KnowledgeService } from './knowledge.service.js';

type Params = { workspaceId?: string; id: string };
type Pagination = { page?: string; pageSize?: string; query?: string };

/**
 * Register inside an encapsulated plugin so binary parsing does not change attachment or ordinary JSON routes.
 */
export function registerKnowledgeController(server: FastifyInstance, service: KnowledgeService): void {
  server.register((scope, _options, done) => {
    scope.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: 100 * 1024 * 1024 },
      (_request, body, next) => next(null, body)
    );
    for (const base of ['/knowledge/global', '/workspaces/:workspaceId/knowledge']) {
      scope.get<{ Params: Params }>(base + '/collections/:id', (request) =>
        service.call(request.params.workspaceId, 'collections.get', { id: request.params.id })
      );
      scope.get<{ Params: Params; Querystring: Pagination }>(base + '/collections', (request) =>
        service.call(request.params.workspaceId, 'collections.list', {
          page: Number(request.query.page ?? 1),
          pageSize: Number(request.query.pageSize ?? 20),
          scope: request.params.workspaceId
            ? { kind: 'workspace', workspaceId: request.params.workspaceId }
            : { kind: 'global' },
        })
      );
      scope.post<{ Params: Params; Body: { name: string; description?: string } }>(
        base + '/collections',
        (request) =>
          service.call(request.params.workspaceId, 'collections.create', {
            name: request.body?.name,
            description: request.body?.description,
            scope: request.params.workspaceId
              ? { kind: 'workspace', workspaceId: request.params.workspaceId }
              : { kind: 'global' },
          })
      );
      scope.patch<{ Params: Params; Body: Omit<KnowledgeOperations['collections.update']['input'], 'id'> }>(
        base + '/collections/:id',
        (request) =>
          service.call(request.params.workspaceId, 'collections.update', {
            id: request.params.id,
            revision: request.body?.revision,
            patch: request.body?.patch,
          })
      );
      scope.delete<{ Params: Params; Body: { revision: number } }>(base + '/collections/:id', (request) =>
        service.call(request.params.workspaceId, 'collections.delete', {
          id: request.params.id,
          revision: request.body?.revision,
        })
      );
      scope.get<{ Params: Params; Querystring: Pagination }>(base + '/collections/:id/documents', (request) =>
        service.call(request.params.workspaceId, 'documents.list', {
          collectionId: request.params.id,
          page: Number(request.query.page ?? 1),
          pageSize: Number(request.query.pageSize ?? 20),
          query: request.query.query,
        })
      );
      scope.delete<{ Params: Params; Body: { revision: number } }>(base + '/documents/:id', (request) =>
        service.call(request.params.workspaceId, 'documents.delete', {
          id: request.params.id,
          revision: request.body?.revision,
        })
      );
      scope.patch<{ Params: Params; Body: { revision: number; title: string } }>(
        base + '/documents/:id',
        (request) =>
          service.call(request.params.workspaceId, 'documents.update', {
            id: request.params.id,
            revision: request.body?.revision,
            title: request.body?.title,
          })
      );
      scope.post<{ Params: Params; Body: Buffer }>(
        base + '/uploads',
        { bodyLimit: 100 * 1024 * 1024 },
        (request) => {
          if (!Buffer.isBuffer(request.body)) {
            throw new ApplicationError('INVALID_INPUT', '上传必须为原始文件内容', { statusCode: 400 });
          }
          return service.upload(request.params.workspaceId, request.body);
        }
      );
      scope.post<{ Params: Params; Body: Omit<KnowledgeOperations['jobs.import']['input'], 'collectionId'> }>(
        base + '/collections/:id/imports',
        (request) =>
          service.call(request.params.workspaceId, 'jobs.import', {
            collectionId: request.params.id,
            requestId: request.body?.requestId,
            source: request.body?.source,
          })
      );
      scope.post<{
        Params: Params;
        Body: Omit<KnowledgeOperations['jobs.reindex']['input'], 'collectionId'>;
      }>(base + '/collections/:id/reindex', (request) =>
        service.call(request.params.workspaceId, 'jobs.reindex', {
          collectionId: request.params.id,
          requestId: request.body?.requestId,
          ...(request.body?.documentIds !== undefined ? { documentIds: request.body.documentIds } : {}),
        })
      );
      scope.get<{ Params: Params }>(base + '/jobs/:id', (request) =>
        service.call(request.params.workspaceId, 'jobs.get', { id: request.params.id })
      );
      scope.post<{ Params: Params }>(base + '/jobs/:id/cancel', (request) =>
        service.call(request.params.workspaceId, 'jobs.cancel', { id: request.params.id })
      );
      scope.post<{ Params: Params; Body: { expectedAttempt: number } }>(base + '/jobs/:id/retry', (request) =>
        service.call(request.params.workspaceId, 'jobs.retry', {
          id: request.params.id,
          expectedAttempt: request.body?.expectedAttempt,
        })
      );
      scope.post<{ Params: Params; Body: KnowledgeOperations['search']['input'] }>(
        base + '/search',
        (request) => service.call(request.params.workspaceId, 'search', request.body)
      );
      scope.get<{ Params: Params }>(base + '/evidence/:id', (request) =>
        service.call(request.params.workspaceId, 'read', { citationId: request.params.id })
      );
    }
    scope.get('/settings/knowledge/models', () => service.call(undefined, 'settings.get', {}));
    scope.post<{ Body: KnowledgeOperations['settings.probe']['input'] }>(
      '/settings/knowledge/models/probe',
      (request) => service.call(undefined, 'settings.probe', request.body)
    );
    scope.get('/settings/knowledge/sharing', () => service.call(undefined, 'sharing.get', {}));
    scope.put<{ Body: KnowledgeOperations['sharing.save']['input'] }>(
      '/settings/knowledge/sharing',
      (request) => service.call(undefined, 'sharing.save', request.body)
    );
    scope.get('/settings/knowledge/mounts/connections', () =>
      service.call(undefined, 'mounts.connections', {})
    );
    scope.get('/settings/knowledge/mounts', () => service.call(undefined, 'mounts.list', {}));
    scope.post<{ Body: { connectionRef: string } }>('/settings/knowledge/mounts', (request) =>
      service.call(undefined, 'mounts.create', request.body)
    );
    scope.post<{ Params: { id: string } }>('/settings/knowledge/mounts/:id/refresh', (request) =>
      service.call(undefined, 'mounts.refresh', { id: request.params.id })
    );
    scope.delete<{ Params: { id: string } }>('/settings/knowledge/mounts/:id', (request) =>
      service.call(undefined, 'mounts.delete', { id: request.params.id })
    );
    scope.put<{ Body: KnowledgeOperations['settings.save']['input'] }>(
      '/settings/knowledge/models',
      (request) => service.call(undefined, 'settings.save', request.body)
    );
    scope.get('/settings/knowledge/service/status', () => service.lifecycle('status'));
    scope.get('/settings/knowledge/service/health', () => service.lifecycle('health'));
    scope.post<{ Params: { action: string } }>('/settings/knowledge/service/:action', (request) => {
      const action = request.params.action;
      if (action !== 'start' && action !== 'stop' && action !== 'restart') {
        throw new ApplicationError('INVALID_INPUT', '服务命令无效', { statusCode: 400 });
      }
      return service.lifecycle(action);
    });
    done();
  });
}
