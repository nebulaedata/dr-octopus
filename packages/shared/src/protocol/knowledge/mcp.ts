/**
 * @author Codex
 * @description Versioned, bounded contract shared by the knowledge MCP publisher and mount client.
 */
import { z } from 'zod';

const id = z.string().min(1).max(128);
export const knowledgeLocatorSchema = z.object({
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  sheet: z.string().max(240).optional(),
  row: z.number().int().positive().optional(),
  paragraph: z.number().int().nonnegative().optional(),
  archivePath: z.string().max(2000).optional(),
});
export const remoteCollectionSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
});
export const remoteHitSchema = z.object({
  remoteReadRef: id,
  collectionId: id,
  documentId: id,
  documentVersionId: id,
  chunkId: id,
  title: z.string().max(240),
  text: z.string().max(8000),
  locator: knowledgeLocatorSchema,
});
export const knowledgeMcpSchemas = {
  knowledge_describe: {
    input: z.object({}).strict(),
    output: z.object({
      productId: z.literal('dr-octopus'),
      protocolVersion: z.literal('octopus-knowledge/v1'),
      serverVersion: z.string().max(80),
      instanceId: id,
      capabilities: z.object({
        collectionCatalog: z.literal(true),
        search: z.literal(true),
        read: z.literal(true),
        documentListing: z.literal(false),
        mutations: z.literal(false),
      }),
      limits: z.object({
        maxCollections: z.literal(20),
        maxQueryChars: z.literal(2000),
        maxHits: z.literal(20),
      }),
    }),
  },
  knowledge_list_collections: {
    input: z
      .object({ cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(100).default(20) })
      .strict(),
    output: z.object({
      items: z.array(remoteCollectionSchema).max(100),
      nextCursor: z.string().max(512).nullable(),
      catalogRevision: id,
    }),
  },
  knowledge_search: {
    input: z
      .object({
        collectionIds: z.array(id).min(1).max(20),
        query: z.string().trim().min(1).max(2000),
        topK: z.number().int().min(1).max(20).default(8),
      })
      .strict(),
    output: z.object({
      hits: z.array(remoteHitSchema).max(20),
      coverage: z.enum(['complete', 'partial', 'unavailable']),
      sources: z
        .array(
          z.object({
            collectionRef: id,
            state: z.enum(['ready', 'unavailable']),
            reason: z.string().max(120).optional(),
          })
        )
        .max(20),
      warnings: z.array(z.string().max(120)).max(40),
    }),
  },
  knowledge_read: {
    input: z.object({ readRef: id, maxChars: z.number().int().min(1).max(8000).default(8000) }).strict(),
    output: z.object({
      collectionId: id,
      documentId: id,
      documentVersionId: id,
      chunkId: id,
      text: z.string().max(8000),
      locator: knowledgeLocatorSchema,
      truncated: z.boolean(),
    }),
  },
};
export type KnowledgeMcpTool = keyof typeof knowledgeMcpSchemas;
export type RemoteCollection = z.infer<typeof remoteCollectionSchema>;
export interface KnowledgeSharing {
  revision: number;
  instanceId: string;
  enabled: boolean;
  collectionIds: string[];
  network: 'loopback' | 'tls';
  allowedHosts: string[];
  allowedOrigins: string[];
  tokenExpiresAt: string | null;
  tokenConfigured: boolean;
}
export interface KnowledgeMount {
  id: string;
  connectionRef: string;
  instanceId: string;
  enabled: boolean;
  catalog: RemoteCollection[];
  lastSuccessAt: string | null;
  error: string | null;
}
