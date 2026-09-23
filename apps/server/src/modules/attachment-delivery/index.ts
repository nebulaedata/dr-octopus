/**
 * @author Codex
 * @description Shares Agent attachment delivery without owning upload or retention state.
 */
import fp from 'fastify-plugin';
import { AttachmentDeliveryService } from './attachment-delivery.service.js';
import type { FastifyPluginCallback } from 'fastify';
export { AttachmentDeliveryService } from './attachment-delivery.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    attachmentDeliveryService: AttachmentDeliveryService;
  }
}
/**
 * Borrows attachment source metadata and immutable storage from their existing owner.
 */
const plugin: FastifyPluginCallback = (server, _options, done) => {
  server.decorate(
    'attachmentDeliveryService',
    new AttachmentDeliveryService(server.attachmentsService, server.attachmentsService.blobStore)
  );
  done();
};
export default fp(plugin, { name: 'attachment-delivery', fastify: '5.x', dependencies: ['attachments'] });
