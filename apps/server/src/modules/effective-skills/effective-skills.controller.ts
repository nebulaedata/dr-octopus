/**
 * @author Codex
 * @description Registers the read-only effective skill catalog.
 * GET /api/workspaces/:workspaceId/effective-skills
 */
import type { FastifyInstance } from 'fastify';
import type { EffectiveSkillsService } from './effective-skills.service.js';
interface WorkspaceSkillsRouteParams {
  workspaceId: string;
}
interface EffectiveSkillsQuery {
  runtimeId?: string;
}
/**
 * Preserves live-runtime and dormant-preview selection.
 */
export function registerEffectiveSkillsController(
  server: FastifyInstance,
  effectiveSkillsService: EffectiveSkillsService
): void {
  server.get<{ Params: WorkspaceSkillsRouteParams; Querystring: EffectiveSkillsQuery }>(
    '/workspaces/:workspaceId/effective-skills',
    async (request) =>
      effectiveSkillsService.list(request.params.workspaceId, request.query.runtimeId?.trim() || undefined)
  );
}
