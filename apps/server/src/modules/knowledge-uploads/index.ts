/**
 * @author Codex
 * @description Owns knowledge upload staging and drains publication before database shutdown.
 */
import fp from 'fastify-plugin';
import { join } from 'node:path';
import { resolveServerPaths } from '../../infrastructure/config/server-paths.js';
import { KnowledgeUploadsRepository } from './knowledge-uploads.repository.js';
import { KnowledgeUploadStore } from './knowledge-uploads.service.js';
import { registerKnowledgeUploads } from './knowledge-uploads.controller.js';
import type { FastifyPluginCallback } from 'fastify';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
/**
 * Preserves the upload expiry cadence and serialized cleanup.
 */
const plugin: FastifyPluginCallback<BusinessModulesOptions> = (server, options, done) => {
  const store = new KnowledgeUploadStore(
    new KnowledgeUploadsRepository(server.database),
    join((options.storagePaths ?? resolveServerPaths()).stateRoot, 'knowledge-uploads'),
    server.knowledgeService
  );
  registerKnowledgeUploads(server, store, server.workspacesService);
  let cleanup: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    cleanup = cleanup
      .then(() => store.deleteExpired())
      .catch((error: unknown) => server.log.warn({ err: error }, 'Knowledge upload cleanup failed'));
  }, 60_000);
  timer.unref();
  server.addHook('preClose', async () => {
    clearInterval(timer);
    await cleanup;
    await store.close();
  });
  done();
};
export const autoPrefix = '/api';
export default fp(plugin, {
  name: 'knowledge-uploads',
  fastify: '5.x',
  encapsulate: true,
  dependencies: ['knowledge'],
  decorators: { fastify: ['database'] },
});
