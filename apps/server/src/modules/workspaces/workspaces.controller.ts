/**
 * @author Codex
 * @description Registers Workspace lifecycle and filesystem endpoints.
 * - GET /api/workspaces
 * - POST /api/workspaces
 * - GET /api/workspaces/:workspaceId/files
 * - POST /api/workspaces/:workspaceId/files
 * - DELETE /api/workspaces/:workspaceId/files
 * - POST /api/workspaces/:workspaceId/files/upload
 * - GET /api/workspaces/:workspaceId/files/content
 * - PUT /api/workspaces/:workspaceId/files/content
 * - GET /api/workspaces/:workspaceId/files/download
 */
import { createReadStream } from 'node:fs';
import { toWorkspaceDto } from './workspaces.utils.js';
import type { FastifyInstance } from 'fastify';
import type {
  CreateWorkspaceBody,
  CreateWorkspaceEntryBody,
  DeleteWorkspaceEntriesBody,
  DownloadWorkspaceEntryQuery,
  ListWorkspaceFilesQuery,
  ReadWorkspaceFileQuery,
  UpdateWorkspaceFileBody,
  UploadWorkspaceFileBody,
  WorkspaceRouteParams,
} from './workspaces.dto.js';
import type { WorkspacesService } from './workspaces.service.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Registers all Workspace routes behind one application Interface.
 *
 * @param server Fastify application receiving the routes.
 * @param service Unified Workspace application behavior.
 */
export function registerWorkspacesController(server: FastifyInstance, service: WorkspacesService): void {
  server.get('/workspaces', async () => (await service.list()).map(toWorkspaceDto));

  server.post<{ Body: CreateWorkspaceBody }>('/workspaces', async (request, reply) =>
    reply.status(201).send(toWorkspaceDto(await service.create(request.body)))
  );

  server.get<{ Params: WorkspaceRouteParams; Querystring: ListWorkspaceFilesQuery }>(
    '/workspaces/:workspaceId/files',
    async (request) => {
      const entries = await service.listEntries(request.params.workspaceId, request.query.path ?? '');
      return { entries };
    }
  );

  server.post<{ Params: WorkspaceRouteParams; Body: CreateWorkspaceEntryBody }>(
    '/workspaces/:workspaceId/files',
    async (request, reply) => {
      const entry = await service.createEntry(
        request.params.workspaceId,
        request.body.path,
        request.body.type
      );
      reply.status(201);
      return { entry };
    }
  );

  server.delete<{ Params: WorkspaceRouteParams; Body: DeleteWorkspaceEntriesBody }>(
    '/workspaces/:workspaceId/files',
    async (request) => {
      await service.deleteEntries(request.params.workspaceId, request.body.paths);
      return { deleted: request.body.paths };
    }
  );

  server.post<{ Params: WorkspaceRouteParams; Body: UploadWorkspaceFileBody }>(
    '/workspaces/:workspaceId/files/upload',
    { bodyLimit: MAX_UPLOAD_BYTES },
    async (request, reply) => {
      const entry = await service.writeUploadedFile(
        request.params.workspaceId,
        request.body.path,
        request.body.name,
        request.body.data
      );
      reply.status(201);
      return { entry };
    }
  );

  server.get<{ Params: WorkspaceRouteParams; Querystring: ReadWorkspaceFileQuery }>(
    '/workspaces/:workspaceId/files/content',
    async (request) => ({
      content: await service.readFileContent(request.params.workspaceId, request.query.path ?? ''),
    })
  );

  server.put<{ Params: WorkspaceRouteParams; Body: UpdateWorkspaceFileBody }>(
    '/workspaces/:workspaceId/files/content',
    { bodyLimit: MAX_UPLOAD_BYTES },
    async (request) => {
      await service.updateFileContent(request.params.workspaceId, request.body.path, request.body.content);
      return { saved: true };
    }
  );

  server.get<{ Params: WorkspaceRouteParams; Querystring: DownloadWorkspaceEntryQuery }>(
    '/workspaces/:workspaceId/files/download',
    async (request, reply) => {
      const download = await service.prepareDownload(request.params.workspaceId, request.query.path ?? '');
      reply.header('content-disposition', `attachment; filename="${encodeURIComponent(download.filename)}"`);
      reply.type(download.kind === 'zip' ? 'application/zip' : 'application/octet-stream');
      return reply.send(download.kind === 'file' ? createReadStream(download.absolutePath) : download.stream);
    }
  );
}
