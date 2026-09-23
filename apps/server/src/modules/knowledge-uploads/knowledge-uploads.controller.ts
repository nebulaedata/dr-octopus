/**
 * @author Codex
 * @description Knowledge-purpose tus transport with global/workspace scope validation, separate from chat attachment rules.
 * - OPTIONS/POST <knowledge-base>/uploads/tus
 * - OPTIONS/HEAD/PATCH/DELETE <knowledge-base>/uploads/tus/:uploadId
 * - GET <knowledge-base>/uploads/tus/:uploadId/result
 */
import { Server as TusServer } from '@tus/server';
import { createHash } from 'node:crypto';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import type { FastifyInstance } from 'fastify';
import type { WorkspacesService } from '../workspaces/index.js';
import type { KnowledgeUploadStore } from './knowledge-uploads.service.js';

/**
 * Reuse @tus/server and bounded staging without introducing knowledge policy into the ordinary attachment controller.
 */
export function registerKnowledgeUploads(
  server: FastifyInstance,
  store: KnowledgeUploadStore,
  workspaces: WorkspacesService
): void {
  server.register((scope, _options, done) => {
    scope.addContentTypeParser('application/offset+octet-stream', (_request, _payload, next) => next(null));
    for (const base of ['/knowledge/global', '/workspaces/:workspaceId/knowledge']) {
      const tus = new TusServer({
        path: '/api' + base.replace(':workspaceId', ''),
        datastore: store,
        maxSize: 100 * 1024 ** 2,
        relativeLocation: true,
        disableTerminationForFinishedUploads: true,
        namingFunction: (request) => {
          const workspace = new URL(request.url).pathname.match(/\/workspaces\/([^/]+)\/knowledge\//u)?.[1];
          return createHash('sha256')
            .update(
              JSON.stringify([
                workspace ? decodeURIComponent(workspace) : null,
                request.headers.get('idempotency-key'),
              ])
            )
            .digest('hex');
        },
        generateUrl: (request, options) => `${new URL(request.url).pathname}/${options.id}`,
        onUploadCreate: async (request, upload) => {
          const workspaceId = new URL(request.url).pathname.match(/\/workspaces\/([^/]+)\/knowledge\//u)?.[1];
          if (workspaceId) {
            await workspaces.resolve({ id: decodeURIComponent(workspaceId) });
          }
          const filename = upload.metadata?.['filename'];
          const requestId = request.headers.get('idempotency-key');
          if (
            !requestId ||
            !/^[\da-f-]{36}$/iu.test(requestId) ||
            !filename ||
            filename.length > 240 ||
            [...filename].some((char) => char < ' ' || char === '/' || char === '\\') ||
            !/\.(docx|xlsx|pptx|csv|md|txt|pdf|zip|tar|gz|tgz)$/iu.test(filename) ||
            !upload.size ||
            Object.keys(upload.metadata ?? {}).some((key) => key !== 'filename')
          ) {
            throw new ApplicationError('INVALID_INPUT', '知识库上传文件或元信息无效', { statusCode: 400 });
          }
          return {
            metadata: {
              filename,
              requestId,
              workspaceId: workspaceId ? decodeURIComponent(workspaceId) : null,
            },
          };
        },
        onResponseError: (_request, error) =>
          error instanceof ApplicationError
            ? {
                status_code: error.statusCode,
                body: JSON.stringify({ error: { code: error.code, message: error.message } }),
              }
            : undefined,
      });
      type Params = { workspaceId?: string; uploadId?: string };
      for (const suffix of ['', '/:uploadId']) {
        scope.route<{ Params: Params }>({
          method: suffix ? ['OPTIONS', 'HEAD', 'PATCH', 'DELETE'] : ['OPTIONS', 'POST'],
          url: base + '/uploads/tus' + suffix,
          bodyLimit: 8 * 1024 ** 2,
          preHandler: async (request) => {
            if (request.params.workspaceId) {
              await workspaces.resolve({ id: request.params.workspaceId });
            }
            if (request.params.uploadId && request.method !== 'OPTIONS') {
              store.require(request.params.uploadId, request.params.workspaceId);
            }
          },
          handler: async (request, reply) => {
            reply.hijack();
            await tus.handle(request.raw, reply.raw);
          },
        });
      }
      scope.get<{ Params: Params }>(base + '/uploads/tus/:uploadId/result', (request) =>
        store.finalize(request.params.uploadId!, request.params.workspaceId)
      );
    }
    done();
  });
}
