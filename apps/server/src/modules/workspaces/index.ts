/**
 * @author Codex
 * @description Owns the workspace service and exposes it to dependent module entrypoints.
 */
import fp from 'fastify-plugin';
import { createWorkspaceService } from '@octopus/agent';
import { WorkspacesService } from './workspaces.service.js';
import { registerWorkspacesController, registerWorkspaceImageErrors } from './workspaces.controller.js';
import type { FastifyPluginCallback } from 'fastify';
export { WorkspacesService } from './workspaces.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    workspacesService: WorkspacesService;
  }
}
/**
 * Assembles workspace access once and isolates its HTTP routes.
 */
const workspacesModule: FastifyPluginCallback = (server, _options, done) => {
  registerWorkspaceImageErrors();
  const service = new WorkspacesService({ workspaceBackend: createWorkspaceService() });
  server.decorate('workspacesService', service);
  server.register(
    (scope, _options, complete) => {
      registerWorkspacesController(scope, service);
      complete();
    },
    { prefix: '/api' }
  );
  done();
};
export default fp(workspacesModule, { name: 'workspaces', fastify: '5.x' });
