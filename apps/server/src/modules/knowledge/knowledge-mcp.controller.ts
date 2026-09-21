/**
 * @author Codex
 * @description Read-only MCP transport over the independent knowledge daemon.
 * POST /mcp/knowledge
 * GET /mcp/knowledge
 * DELETE /mcp/knowledge
 */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createKnowledgeClient, KnowledgeError } from '@octopus/agent';
import { knowledgeMcpSchemas } from '@octopus/shared/protocol/knowledge';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { KnowledgeClient, KnowledgeSharing } from '@octopus/shared/protocol/knowledge';

/**
 * Retain one stateless official handler; each request receives a fresh scoped tool server.
 */
export function registerKnowledgeMcpController(server: FastifyInstance, agentDir: string): void {
  const client = createKnowledgeClient({
    agentDir,
    autostart: false,
    context: { principal: 'mcp:knowledge', globalWrite: false, modelAccess: 'none' },
  });
  const requestSignals = new AsyncLocalStorage<AbortSignal>();
  const handler = createMcpHandler((context) => {
    const signal = requestSignals.getStore() ?? AbortSignal.timeout(30_000);
    const scoped: KnowledgeClient = {
      call: (operation, input, callerSignal) =>
        client.call(operation, input, callerSignal ? AbortSignal.any([signal, callerSignal]) : signal),
      upload: (bytes, callerSignal) => client.upload(bytes, callerSignal),
    };
    return createServer(scoped, context.requestInfo?.headers.get('authorization')?.slice(7) ?? '');
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
        let checking = false;
        const permissionTimer = setInterval(() => {
          if (checking || signal.aborted) {
            return;
          }
          checking = true;
          void client
            .call('sharing.authorize', { token: authorization.slice(7) }, signal)
            .then(
              (latest) => {
                if (latest.revision !== policy.revision) {
                  cancelled.abort();
                }
              },
              () => cancelled.abort()
            )
            .finally(() => {
              checking = false;
            });
        }, 1000);
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
          clearInterval(permissionTimer);
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

/**
 * Register the four fixed tools; no generic operation forwarding is exposed to MCP callers.
 */
function createServer(client: KnowledgeClient, token: string): McpServer {
  const server = new McpServer({ name: 'dr-octopus-knowledge', version: '1.0.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool(
    'knowledge_describe',
    {
      inputSchema: knowledgeMcpSchemas.knowledge_describe.input,
      outputSchema: knowledgeMcpSchemas.knowledge_describe.output,
      annotations,
    },
    () =>
      result(async () => {
        const policy = await client.call('sharing.authorize', { token });
        return {
          productId: 'dr-octopus',
          serverVersion: '1.0.0',
          protocolVersion: 'octopus-knowledge/v1',
          instanceId: policy.instanceId,
          capabilities: {
            collectionCatalog: true,
            search: true,
            read: true,
            documentListing: false,
            mutations: false,
          },
          limits: { maxCollections: 20, maxQueryChars: 2000, maxHits: 20 },
        };
      })
  );
  server.registerTool(
    'knowledge_list_collections',
    {
      inputSchema: knowledgeMcpSchemas.knowledge_list_collections.input,
      outputSchema: knowledgeMcpSchemas.knowledge_list_collections.output,
      annotations,
    },
    (input) =>
      result(async () => {
        const catalog = await client.call('sharing.catalog', { token });
        let offset = 0;
        if (input.cursor) {
          const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as {
            offset?: number;
            revision?: string;
            expires?: number;
          };
          if (
            cursor.revision !== catalog.revision ||
            !Number.isInteger(cursor.offset) ||
            cursor.offset! < 0 ||
            !cursor.expires ||
            cursor.expires < Date.now()
          ) {
            throw new KnowledgeError('REVISION_EXPIRED', '目录游标已过期');
          }
          offset = cursor.offset!;
        }
        const end = offset + input.limit;
        return {
          items: catalog.items.slice(offset, end),
          catalogRevision: catalog.revision,
          nextCursor:
            end < catalog.items.length
              ? Buffer.from(
                  JSON.stringify({ offset: end, revision: catalog.revision, expires: Date.now() + 60_000 })
                ).toString('base64url')
              : null,
        };
      })
  );
  server.registerTool(
    'knowledge_search',
    {
      inputSchema: knowledgeMcpSchemas.knowledge_search.input,
      outputSchema: knowledgeMcpSchemas.knowledge_search.output,
      annotations,
    },
    (input) =>
      result(async () => {
        const policy = await authorize(client, token, input.collectionIds);
        const response = await client.call(
          'search',
          { collectionIds: input.collectionIds, query: input.query, limit: input.topK },
          AbortSignal.timeout(30_000)
        );
        const latest = await authorize(client, token, input.collectionIds);
        if (policy.revision !== latest.revision) {
          throw new KnowledgeError('FORBIDDEN', '发布权限已变更');
        }
        return {
          hits: response.hits.map((hit) => ({
            remoteReadRef: hit.citationId,
            collectionId: hit.collectionId,
            documentId: hit.documentId,
            documentVersionId: hit.documentVersionId,
            chunkId: hit.chunkId,
            title: hit.title.slice(0, 240),
            text: hit.text.slice(0, 8000),
            locator: hit.locator,
          })),
          coverage: response.coverage,
          sources: response.sources,
          warnings: response.warnings.slice(0, 40),
        };
      })
  );
  server.registerTool(
    'knowledge_read',
    {
      inputSchema: knowledgeMcpSchemas.knowledge_read.input,
      outputSchema: knowledgeMcpSchemas.knowledge_read.output,
      annotations,
    },
    (input) =>
      result(async () => {
        if (input.readRef.startsWith('remote_')) {
          throw new KnowledgeError('FORBIDDEN', '不能再次发布远端知识库');
        }
        const policy = await client.call('sharing.authorize', { token });
        const chunk = await client.call('read', { citationId: input.readRef });
        const latest = await authorize(client, token, [chunk.collectionId]);
        if (policy.revision !== latest.revision) {
          throw new KnowledgeError('FORBIDDEN', '发布权限已变更');
        }
        return {
          collectionId: chunk.collectionId,
          documentId: chunk.documentId,
          documentVersionId: chunk.documentVersionId,
          chunkId: chunk.chunkId,
          text: chunk.text.slice(0, input.maxChars),
          locator: chunk.locator,
          truncated: chunk.text.length > input.maxChars,
        };
      })
  );
  return server;
}

/**
 * Require the intersection of live local global collections and this publication token's allowlist.
 */
async function authorize(client: KnowledgeClient, token: string, ids: string[]): Promise<KnowledgeSharing> {
  const policy = await client.call('sharing.authorize', { token });
  if (ids.some((id) => !policy.collectionIds.includes(id))) {
    throw new KnowledgeError('FORBIDDEN', '集合未向此令牌发布');
  }
  return policy;
}

/**
 * Preserve standard text fallback alongside structured results, without exposing internal exceptions.
 */
async function result(action: () => Promise<Record<string, unknown>>) {
  try {
    const value = await action();
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value };
  } catch (error) {
    const code = error instanceof KnowledgeError ? error.code : 'UNAVAILABLE';
    const value = {
      code,
      message: '知识库请求未完成',
      requestId: createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 12),
    };
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify(value) }],
      structuredContent: value,
    };
  }
}
