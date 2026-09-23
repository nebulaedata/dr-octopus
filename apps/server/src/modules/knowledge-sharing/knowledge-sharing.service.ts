/**
 * @author Codex
 * @description Exposes the fixed, independently authorized read-only knowledge sharing operations.
 */
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { createKnowledgeClient, KnowledgeError } from '@octopus/agent';
import { knowledgeMcpSchemas } from '@octopus/shared/protocol/knowledge';
import type { KnowledgeClient, KnowledgeSharing } from '@octopus/shared/protocol/knowledge';
/**
 * Creates the restricted client without starting the knowledge daemon.
 */
export function createKnowledgeSharingClient(agentDir: string): KnowledgeClient {
  return createKnowledgeClient({
    agentDir,
    autostart: false,
    context: { principal: 'mcp:knowledge', globalWrite: false, modelAccess: 'none' },
  });
}
/**
 * Register the four fixed tools; no generic operation forwarding is exposed to MCP callers.
 */
export function createKnowledgeMcpServer(client: KnowledgeClient, token: string): McpServer {
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
