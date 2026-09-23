/**
 * @author Codex
 * @description Read-only MCP transport over the independent knowledge daemon.
 * POST /mcp/knowledge
 * GET /mcp/knowledge
 * DELETE /mcp/knowledge
 */
import { createKnowledgeMcpServer } from './knowledge-sharing.service.js';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { KnowledgeError } from '@octopus/agent';

import { AsyncLocalStorage } from 'node:async_hooks';

import type { KnowledgeClient, KnowledgeSharing } from '@octopus/shared/protocol/knowledge';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Retain one stateless official handler; each request receives a fresh scoped tool server.
 */
export function registerKnowledgeMcpController(
  server: FastifyInstance,
  client: KnowledgeClient,
  subscribe?: (listener: () => void) => () => void
): void {
  const requestSignals = new AsyncLocalStorage<AbortSignal>();
  const handler = createMcpHandler((context) => {
    const signal = requestSignals.getStore() ?? AbortSignal.timeout(30_000);
    const scoped: KnowledgeClient = {
      call: (operation, input, callerSignal) =>
        client.call(operation, input, callerSignal ? AbortSignal.any([signal, callerSignal]) : signal),
      upload: (bytes, callerSignal) => client.upload(bytes, callerSignal),
    };
    return createKnowledgeMcpServer(
      scoped,
      context.requestInfo?.headers.get('authorization')?.slice(7) ?? ''
    );
  });
  let active = 0;
  let windowStart = Date.now();
  let count = 0;
  server.addHook('onClose', () => handler.close());
  server.route({
    method: ['POST', 'GET', 'DELETE'],
    url: '/mcp/knowledge',
    bodyLimit: 64 * 1024,
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (request.method !== 'POST') {
        return reply.code(405).send({ error: 'METHOD_NOT_ALLOWED' });
      }
      const method = (request.body as { method?: unknown } | null)?.method;
      if (
        typeof method !== 'string' ||
        ![
          'initialize',
          'server/discover',
          'ping',
          'tools/list',
          'tools/call',
          'notifications/initialized',
        ].includes(method)
      ) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer ') || authorization.length > 4096) {
        return reply.code(401).send({ error: 'AUTH_REQUIRED' });
      }
      try {
        const policy = await client.call('sharing.authorize', { token: authorization.slice(7) });
        if (!allowedRequest(request, policy)) {
          return reply.code(403).send({ error: 'FORBIDDEN' });
        }
        if (Date.now() - windowStart >= 60_000) {
          windowStart = Date.now();
          count = 0;
        }
        if (active >= 4 || count >= 120) {
          return reply.code(429).header('retry-after', '10').send({ error: 'RATE_LIMITED' });
        }
        active++;
        count++;
        const cancelled = new AbortController();
        const signal = AbortSignal.any([cancelled.signal, AbortSignal.timeout(30_000)]);
        const disconnected = () => {
          if (!reply.raw.writableEnded) {
            cancelled.abort();
          }
        };
        reply.raw.once('close', disconnected);
        const bearerToken = authorization.slice(7);
        let pendingCheck: Promise<void> | undefined;
        let dirty = false;
        /**
         * Revalidates once per change burst and compensates for events received during authorization.
         */
        function recheck(): void {
          dirty = true;
          if (pendingCheck || signal.aborted) {
            return;
          }
          pendingCheck = (async () => {
            while (dirty && !signal.aborted) {
              dirty = false;
              try {
                const latest = await client.call('sharing.authorize', { token: bearerToken }, signal);
                if (latest.revision !== policy.revision) {
                  cancelled.abort();
                }
              } catch {
                cancelled.abort();
              }
            }
          })().finally(() => {
            pendingCheck = undefined;
          });
        }
        const unsubscribe = subscribe?.(recheck);
        if (subscribe) {
          recheck();
        }
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (value !== undefined) {
              headers.set(key, Array.isArray(value) ? value.join(', ') : value);
            }
          }
          const webRequest = new Request(`${request.protocol}://${request.host}${request.url}`, {
            method: request.method,
            headers,
            ...(request.method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
          });
          const response = await requestSignals.run(signal, () =>
            handler.fetch(webRequest, { parsedBody: request.body })
          );
          response.headers.forEach((value, key) => {
            reply.header(key, value);
          });
          const bytes = new Uint8Array(await response.arrayBuffer());
          // Even metadata responses are withheld if token rotation or scope changes occurred during dispatch.
          const latest = await client.call('sharing.authorize', { token: authorization.slice(7) });
          if (latest.revision !== policy.revision) {
            return reply.code(403).send({ error: 'FORBIDDEN' });
          }
          return reply.code(response.status).send(Buffer.from(bytes));
        } finally {
          unsubscribe?.();
          reply.raw.off('close', disconnected);
          cancelled.abort();
          active--;
        }
      } catch (error) {
        return reply
          .code(error instanceof KnowledgeError && error.code === 'AUTH_REQUIRED' ? 401 : 503)
          .send({ error: 'UNAVAILABLE' });
      }
    },
  });
}

/**
 * Require an explicit host/origin allowlist and a separate TLS policy for non-loopback callers.
 */
function allowedRequest(request: FastifyRequest, policy: KnowledgeSharing): boolean {
  let hostname: string;
  try {
    hostname = new URL(`http://${request.host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!policy.allowedHosts.includes(hostname)) {
    return false;
  }
  if (request.headers.origin && !policy.allowedOrigins.includes(request.headers.origin)) {
    return false;
  }
  const peer = request.raw.socket.remoteAddress ?? '';
  const loopback = peer === '::1' || peer === '127.0.0.1' || peer.startsWith('::ffff:127.');
  const secure =
    request.protocol === 'https' || (loopback && request.headers['x-forwarded-proto'] === 'https');
  return policy.network === 'loopback'
    ? loopback && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    : secure;
}
