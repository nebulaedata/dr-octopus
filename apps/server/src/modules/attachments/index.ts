/**
 * @author Codex
 * @description Owns attachment resources, their aggregate lifecycle, and isolated binary routes.
 */
import fp from 'fastify-plugin';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentsService } from './attachments.service.js';
import {
  AttachmentsRepository,
  AttachmentJobsRepository,
  SqliteTusDataStore,
} from './attachments.repository.js';
import { ProcessorSupervisor } from './workers/processor-supervisor.js';
import { LocalFileBlobStore } from '../../infrastructure/attachment-storage/local-file-blob-store.js';
import { AttachmentBackupService } from '../../infrastructure/attachment-storage/attachment-backup-service.js';
import { DEFAULT_MAX_ATTACHMENT_BYTES } from '../../infrastructure/config/defaults.js';
import { registerAttachmentsController, registerAttachmentErrorMessages } from './attachments.controller.js';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { OctopusDatabase } from '../../db/client.js';
import type { AttachmentsServiceOptions } from './attachments.service.js';
import type { BusinessModulesOptions } from '../../plugins/business-modules.plugin.js';
export { AttachmentsService } from './attachments.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    attachmentsService: AttachmentsService;
  }
}
/**
 * Assembles the aggregate for production and isolated tests with the same storage defaults.
 */
export function createAttachmentsService(
  database: OctopusDatabase,
  log: FastifyBaseLogger,
  options: AttachmentsServiceOptions = {}
): AttachmentsService {
  const memoryBacked = database.sqlite.name === ':memory:';
  let ephemeralRoot: string | undefined;
  if (memoryBacked && options.dataRoot === undefined) {
    ephemeralRoot = mkdtempSync(join(tmpdir(), 'octopus-attachments-'));
  }
  if (!memoryBacked && options.dataRoot === undefined) {
    throw new Error('Persistent attachment dataRoot must be injected by the Server composition root.');
  }
  const defaultRoot = options.dataRoot ?? join(ephemeralRoot ?? tmpdir(), 'attachments');
  const repository = options.repository ?? new AttachmentsRepository(database);
  const blobs = options.blobStore ?? new LocalFileBlobStore(defaultRoot);
  return new AttachmentsService({
    log,
    repository,
    blobs,
    jobs: options.jobsRepository ?? new AttachmentJobsRepository(database),
    supervisor: options.supervisor ?? new ProcessorSupervisor(defaultRoot),
    backups: new AttachmentBackupService(
      database,
      blobs,
      options.backupRoot ?? join(ephemeralRoot ?? tmpdir(), 'backups')
    ),
    maxBytes: options.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES,
    ephemeralRoot,
    onChanged: () => options.onChanged?.(),
  });
}
/**
 * Publishes one attachment aggregate and retains the existing response invalidation policy.
 */
const plugin: FastifyPluginAsync<BusinessModulesOptions> = async (server, options) => {
  const service = createAttachmentsService(server.database, server.log, {
    maxBytes: options.config.attachmentLimitBytes,
    onChanged: () => server.dataEvents.publish({ resource: 'attachments' }),
    ...(options.storagePaths === undefined
      ? {}
      : { dataRoot: options.storagePaths.attachmentsRoot, backupRoot: options.storagePaths.backupsRoot }),
  });
  server.decorate('attachmentsService', service);
  server.addHook('onClose', () => service.close());
  registerAttachmentErrorMessages();
  server.register(
    (scope, _options, done) => {
      scope.addHook('onResponse', (request, reply, next) => {
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          reply.statusCode < 400 &&
          request.routeOptions.url?.includes('/attachments')
        ) {
          server.dataEvents.publish({ resource: 'attachments' });
        }
        next();
      });
      registerAttachmentsController(
        scope,
        service,
        server.workspacesService,
        new SqliteTusDataStore(service.repository, service.blobStore)
      );
      done();
    },
    { prefix: '/api' }
  );
  await service.ready();
};
export default fp(plugin, {
  name: 'attachments',
  fastify: '5.x',
  dependencies: ['data-events', 'workspaces'],
  decorators: { fastify: ['database'] },
});
