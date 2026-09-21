/**
 * @author Codex
 * @description Global memory management using the same Agent SDK as TUI and RPC.
 * - GET /api/memory/export
 * - POST /api/memory/rebuild
 * - GET /api/memory/status
 * - GET /api/memory/indexes
 * - POST /api/memory/read
 * - POST /api/memory/remember
 * - POST /api/memory/forget
 * - POST /api/memory/policy
 * - GET /api/memory/service/status
 * - POST /api/memory/service/start
 * - POST /api/memory/service/stop
 * - POST /api/memory/service/restart
 */
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { MemoryRead, MemoryRemember, MemoryForget, MemoryPolicy } from '@octopus/shared/protocol/memory';
import type { MemoryService } from './memory.service.js';
/**
 * Register within the existing Host API authority; no Workspace parameter grants additional access.
 */
export function registerMemoryController(server: FastifyInstance, service: MemoryService) {
  server.get('/memory/service/status', () => service.lifecycle('status'));
  for (const action of ['start', 'stop', 'restart'] as const) {
    server.post(`/memory/service/${action}`, () => service.lifecycle(action));
  }
  server.get('/memory/export', (_request, reply) =>
    reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="memory.md"')
      .send(Readable.from(service.exportWiki()))
  );
  server.post('/memory/rebuild', () => service.rebuildFts());
  server.get('/memory/status', () => service.status());
  server.get<{ Querystring: { query?: string; cursor?: string } }>('/memory/indexes', (request) =>
    service.indexes(
      request.query.query
        ? { mode: 'search', query: request.query.query }
        : { mode: 'page', cursor: request.query.cursor }
    )
  );
  server.post<{ Body: MemoryRead }>('/memory/read', (request) => service.read(request.body));
  server.post<{ Body: MemoryRemember }>('/memory/remember', (request) => service.remember(request.body));
  server.post<{ Body: MemoryForget }>('/memory/forget', (request) => service.forget(request.body));
  server.post<{ Body: MemoryPolicy }>('/memory/policy', (request) => service.policy(request.body));
}
