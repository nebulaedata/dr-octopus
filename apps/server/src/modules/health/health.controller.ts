/**
 * @author Codex
 * @description Registers Server health and capability endpoints.
 * - GET /api/capabilities
 * - GET /api/health
 * - GET /api/ready
 */

import { OCTOPUS_PROTOCOL_VERSION } from '@octopus/shared/protocol';
import { HealthService } from './health.service.js';
import type { FastifyInstance } from 'fastify';
import type { OctopusCapabilities } from '@octopus/shared/protocol';

export type CapabilityLimits = OctopusCapabilities['limits'];

/**
 * Registers process health, readiness, and negotiated Server capabilities.
 */
export function registerHealthController(server: FastifyInstance, limits: CapabilityLimits): void {
  const healthService = new HealthService(server);

  server.get('/capabilities', () => {
    const capabilities: OctopusCapabilities = {
      protocolVersion: OCTOPUS_PROTOCOL_VERSION,
      features: {
        attachments: true,
        commands: true,
        compaction: true,
        extensionUi: true,
        models: true,
        sessionDerivation: true,
        sessionTree: true,
        workModes: true,
        shell: false,
      },
      limits: {
        maxAttachmentBytes: limits.maxAttachmentBytes,
        maxAttachmentsPerMessage: limits.maxAttachmentsPerMessage,
        maxAttachmentMessageBytes: limits.maxAttachmentMessageBytes,
        tusChunkBytes: limits.tusChunkBytes,
        maxPromptCharacters: limits.maxPromptCharacters,
        maxSubscriptionsPerConnection: limits.maxSubscriptionsPerConnection,
        maxWebSocketMessageBytes: limits.maxWebSocketMessageBytes,
      },
    };
    return capabilities;
  });
  server.get('/health', () => ({ status: 'ok' }));
  server.get('/ready', (_request, reply) => {
    const readiness = healthService.getReadiness();
    return reply.status(readiness.status === 'ready' ? 200 : 503).send(readiness);
  });
}
