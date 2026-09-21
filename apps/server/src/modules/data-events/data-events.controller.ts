/**
 * @author Codex
 * @description Streams business invalidations with bounded buffering and explicit connection cleanup.
 * GET /api/data/events
 */
import { isAllowedOrigin } from '../channel/channel.utils.js';
import type { FastifyInstance } from 'fastify';
import type { DataEventsService } from './data-events.service.js';

/**
 * Share the Host access boundary and close long-lived responses before Fastify drains connections.
 */
export function registerDataEventsController(
  server: FastifyInstance,
  events: DataEventsService,
  allowOrigin: string[] | ((origin: string) => boolean)
): void {
  const connections = new Set<() => void>();
  server.addHook('preClose', (done) => {
    for (const close of connections) {
      close();
    }
    events.close();
    done();
  });
  server.get('/data/events', (request, reply) => {
    if (!isAllowedOrigin(request.headers.origin, allowOrigin, request)) {
      return reply.code(403).send({ message: 'Origin is not allowed' });
    }
    reply.hijack();
    const response = reply.raw;
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) {
        response.setHeader(name, value);
      }
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: () => void = () => undefined;
    let closed = false;
    /**
     * Idempotently release the subscription, heartbeat and response.
     */
    function close(force = false): void {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      connections.delete(close);
      if (force) {
        response.destroy();
      } else {
        response.end();
      }
    }
    /**
     * Disconnect slow consumers instead of accumulating unbounded pending frames.
     */
    function write(frame: string): void {
      if (closed) {
        return;
      }
      try {
        if (response.destroyed || !response.write(frame)) {
          close(true);
        }
      } catch {
        close(true);
      }
    }
    connections.add(close);
    response.on('close', close);
    response.on('error', () => close(true));
    unsubscribe = events.subscribe((change) => write(`event: change\ndata: ${JSON.stringify(change)}\n\n`));
    write('retry: 3000\nevent: ready\ndata: {}\n\n');
    if (!closed) {
      heartbeat = setInterval(() => write('event: heartbeat\ndata: {}\n\n'), 15_000);
      heartbeat.unref();
    }
  });
}
