/**
 * @author Codex
 * @description Assembles effective-skills with explicit workspace and runtime resources.
 */
import fp from 'fastify-plugin';

import { EffectiveSkillsService } from './effective-skills.service.js';
import { registerEffectiveSkillsController } from './effective-skills.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Registers an isolated skill catalog endpoint scope.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  registerEffectiveSkillsController(
    server,
    new EffectiveSkillsService({
      workspaceService: server.workspacesService,
      runtime: server.sessionRuntime,
      agentDir: options.config.agentDir,
    })
  );
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, {
  name: 'effective-skills',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['workspaces'],
});
