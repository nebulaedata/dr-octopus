/**
 * @author Codex
 * @description Assembles skills with explicit workspace and runtime resources.
 */
import fp from 'fastify-plugin';
import { join } from 'node:path';
import { SkillsService } from './skills.service.js';
import { registerSkillsController } from './skills.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Registers an isolated skill catalog endpoint scope.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerSkillsController(
    server,
    new SkillsService({
      workspaceService: server.workspacesService,
      skillsRoot: join(options.config.agentDir, 'skills'),
    })
  );
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, {
  name: 'skills',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['workspaces'],
});
