/**
 * @author Codex
 * @description Registers Global and Workspace scope Skill management endpoints.
 * - GET /api/skills
 * - GET /api/skills/:name
 * - POST /api/skills
 * - PUT /api/skills/:name
 * - DELETE /api/skills/:name
 * - POST /api/skills/upload
 * - GET /api/workspaces/:workspaceId/skills
 * - GET /api/workspaces/:workspaceId/skills/:name
 * - POST /api/workspaces/:workspaceId/skills
 * - PUT /api/workspaces/:workspaceId/skills/:name
 * - DELETE /api/workspaces/:workspaceId/skills/:name
 * - POST /api/workspaces/:workspaceId/skills/upload
 * - GET /api/workspaces/:workspaceId/effective-skills
 */

import type { FastifyInstance } from 'fastify';
import type {
  CreateSkillInput,
  SkillScope,
  SkillsService,
  UpdateSkillInput,
  UploadSkillInput,
} from './skills.service.js';
import type { EffectiveSkillsService } from './effective-skills.service.js';
import type {
  CreateSkillBody,
  EffectiveSkillsQuery,
  SkillRouteParams,
  UpdateSkillBody,
  UploadSkillBody,
  WorkspaceSkillRouteParams,
  WorkspaceSkillsRouteParams,
} from './skills.dto.js';

const MAX_SKILL_UPLOAD_REQUEST_BYTES = 24 * 1024 * 1024;

/**
 * Registers all Skill routes behind one application Interface.
 *
 * @param server Fastify application receiving the routes.
 * @param service Managed Skill application behavior.
 * @param effectiveSkillsService Read-only effective Skill catalog behavior.
 */
export function registerSkillsController(
  server: FastifyInstance,
  service: SkillsService,
  effectiveSkillsService: EffectiveSkillsService
): void {
  const globalScope: SkillScope = { kind: 'global' };
  const workspaceScope = (params: WorkspaceSkillsRouteParams): SkillScope => ({
    kind: 'workspace',
    workspaceId: params.workspaceId,
  });

  server.get('/skills', async () => service.list(globalScope));

  server.get<{ Params: SkillRouteParams }>('/skills/:name', async (request) => ({
    skill: await service.get(globalScope, request.params.name),
  }));

  server.post<{ Body: CreateSkillBody }>('/skills', async (request, reply) => {
    const skill = await service.create(globalScope, toCreateInput(request.body));
    reply.status(201);
    return { skill };
  });

  server.put<{ Params: SkillRouteParams; Body: UpdateSkillBody }>('/skills/:name', async (request) => ({
    skill: await service.update(globalScope, request.params.name, toUpdateInput(request.body)),
  }));

  server.delete<{ Params: SkillRouteParams }>('/skills/:name', async (request) => {
    await service.remove(globalScope, request.params.name);
    return { deleted: request.params.name };
  });

  server.post<{ Body: UploadSkillBody }>(
    '/skills/upload',
    { bodyLimit: MAX_SKILL_UPLOAD_REQUEST_BYTES },
    async (request, reply) => {
      const skill = await service.upload(globalScope, toUploadInput(request.body));
      reply.status(201);
      return { skill };
    }
  );

  server.get<{ Params: WorkspaceSkillsRouteParams }>('/workspaces/:workspaceId/skills', async (request) =>
    service.list(workspaceScope(request.params))
  );

  server.get<{ Params: WorkspaceSkillRouteParams }>(
    '/workspaces/:workspaceId/skills/:name',
    async (request) => ({
      skill: await service.get(workspaceScope(request.params), request.params.name),
    })
  );

  server.post<{ Params: WorkspaceSkillsRouteParams; Body: CreateSkillBody }>(
    '/workspaces/:workspaceId/skills',
    async (request, reply) => {
      const skill = await service.create(workspaceScope(request.params), toCreateInput(request.body));
      reply.status(201);
      return { skill };
    }
  );

  server.put<{ Params: WorkspaceSkillRouteParams; Body: UpdateSkillBody }>(
    '/workspaces/:workspaceId/skills/:name',
    async (request) => ({
      skill: await service.update(
        workspaceScope(request.params),
        request.params.name,
        toUpdateInput(request.body)
      ),
    })
  );

  server.delete<{ Params: WorkspaceSkillRouteParams }>(
    '/workspaces/:workspaceId/skills/:name',
    async (request) => {
      await service.remove(workspaceScope(request.params), request.params.name);
      return { deleted: request.params.name };
    }
  );

  server.post<{ Params: WorkspaceSkillsRouteParams; Body: UploadSkillBody }>(
    '/workspaces/:workspaceId/skills/upload',
    { bodyLimit: MAX_SKILL_UPLOAD_REQUEST_BYTES },
    async (request, reply) => {
      const skill = await service.upload(workspaceScope(request.params), toUploadInput(request.body));
      reply.status(201);
      return { skill };
    }
  );

  server.get<{ Params: WorkspaceSkillsRouteParams; Querystring: EffectiveSkillsQuery }>(
    '/workspaces/:workspaceId/effective-skills',
    async (request) =>
      effectiveSkillsService.list(request.params.workspaceId, request.query.runtimeId?.trim() || undefined)
  );
}

/**
 * Maps the optional create payload into the validated Service input shape.
 *
 * @param body Raw create body accepted by the controller.
 */
function toCreateInput(body: CreateSkillBody): CreateSkillInput {
  return {
    name: body.name ?? '',
    description: body.description ?? '',
    ...(body.disableModelInvocation === undefined
      ? {}
      : { disableModelInvocation: body.disableModelInvocation }),
    body: body.body ?? '',
  };
}

/**
 * Maps the optional update payload into the validated Service input shape.
 *
 * @param body Raw update body accepted by the controller.
 */
function toUpdateInput(body: UpdateSkillBody): UpdateSkillInput {
  return {
    description: body.description ?? '',
    ...(body.disableModelInvocation === undefined
      ? {}
      : { disableModelInvocation: body.disableModelInvocation }),
    body: body.body ?? '',
  };
}

/**
 * Maps the optional upload payload into the validated Service input shape.
 *
 * @param body Raw upload body accepted by the controller.
 */
function toUploadInput(body: UploadSkillBody): UploadSkillInput {
  return {
    filename: body.filename ?? '',
    data: body.data ?? '',
    ...(body.overwrite === undefined ? {} : { overwrite: body.overwrite }),
  };
}
