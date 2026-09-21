/**
 * @author Codex
 * @description Strict local operation schemas shared by daemon admission and adapter validation.
 */
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { KnowledgeError } from '../definitions/error.js';
import { modelToolSchemas } from '../definitions/model-tool-schemas.js';
import type { KnowledgeContext } from '../definitions/types.js';
import type { KnowledgeOperations } from '../definitions/client.js';

const id = Type.String({ minLength: 1, maxLength: 128 });
const revision = Type.Integer({ minimum: 0 });
const scope = Type.Union([
  Type.Object({ kind: Type.Literal('global') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('workspace'), workspaceId: id }, { additionalProperties: false }),
]);
const page = {
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  pageSize: Type.Optional(Type.Union([Type.Literal(20), Type.Literal(50), Type.Literal(100)])),
};
const connection = {
  endpoint: Type.String({ minLength: 1, maxLength: 2000 }),
  model: Type.String({ minLength: 1, maxLength: 200 }),
  apiKey: Type.Optional(Type.String({ maxLength: 4000 })),
  timeoutMs: Type.Integer({ minimum: 100, maximum: 120_000 }),
};
const model = Type.Union([
  Type.Object(
    {
      ...connection,
      kind: Type.Literal('embedding'),
      dimensions: Type.Integer({ minimum: 1, maximum: 8192 }),
      batchSize: Type.Integer({ minimum: 1, maximum: 64 }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      ...connection,
      kind: Type.Literal('ocr'),
      mode: Type.Union([Type.Literal('auto'), Type.Literal('force'), Type.Literal('off')]),
      maxOutputTokens: Type.Integer({ minimum: 64, maximum: 8192 }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      ...connection,
      kind: Type.Literal('reranker'),
      enabled: Type.Boolean(),
      allowRemoteEvidence: Type.Boolean(),
      maxCandidates: Type.Integer({ minimum: 1, maximum: 40 }),
    },
    { additionalProperties: false }
  ),
]);
const source = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 240 }),
    format: Type.String({ minLength: 1, maxLength: 12 }),
    blobSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    archivePath: Type.Optional(Type.String({ maxLength: 2000 })),
    documentId: Type.Optional(id),
    expectedRevision: Type.Optional(revision),
  },
  { additionalProperties: false }
);

export const operationSchemas = {
  'models.ocr': Type.Object(
    { blobSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) },
    { additionalProperties: false }
  ),
  'models.embed': modelToolSchemas.embed,
  'models.rerank': modelToolSchemas.rerank,
  'collections.get': Type.Object({ id }, { additionalProperties: false }),
  'sharing.get': Type.Object({}, { additionalProperties: false }),
  'sharing.save': Type.Object(
    {
      revision,
      enabled: Type.Boolean(),
      collectionIds: Type.Array(id, { maxItems: 2000, uniqueItems: true }),
      network: Type.Union([Type.Literal('loopback'), Type.Literal('tls')]),
      allowedHosts: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 20 }),
      allowedOrigins: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 20 }),
      rotateToken: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false }
  ),
  'sharing.authorize': Type.Object(
    { token: Type.String({ maxLength: 4000 }) },
    { additionalProperties: false }
  ),
  'sharing.catalog': Type.Object(
    { token: Type.String({ maxLength: 4000 }) },
    { additionalProperties: false }
  ),
  'mounts.connections': Type.Object({}, { additionalProperties: false }),
  'mounts.list': Type.Object({}, { additionalProperties: false }),
  'mounts.create': Type.Object(
    { connectionRef: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false }
  ),
  'mounts.refresh': Type.Object({ id }, { additionalProperties: false }),
  'mounts.delete': Type.Object({ id }, { additionalProperties: false }),
  'collections.list': Type.Object({ ...page, scope: Type.Optional(scope) }, { additionalProperties: false }),
  'collections.create': Type.Object(
    {
      scope,
      name: Type.String({ minLength: 1, maxLength: 120 }),
      description: Type.Optional(Type.String({ maxLength: 2000 })),
    },
    { additionalProperties: false }
  ),
  'collections.update': Type.Object(
    {
      id,
      revision,
      patch: Type.Object(
        {
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
          description: Type.Optional(Type.String({ maxLength: 2000 })),
          published: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false }
      ),
    },
    { additionalProperties: false }
  ),
  'collections.delete': Type.Object({ id, revision }, { additionalProperties: false }),
  'documents.list': Type.Object(
    { collectionId: id, ...page, query: Type.Optional(Type.String({ maxLength: 200 })) },
    { additionalProperties: false }
  ),
  'documents.delete': Type.Object({ id, revision }, { additionalProperties: false }),
  'documents.update': Type.Object(
    { id, revision, title: Type.String({ minLength: 1, maxLength: 240 }) },
    { additionalProperties: false }
  ),
  'jobs.import': Type.Object({ collectionId: id, requestId: id, source }, { additionalProperties: false }),
  'jobs.importAttachment': Type.Object(
    { collectionId: id, requestId: id, attachmentRef: Type.String({ minLength: 1, maxLength: 8192 }) },
    { additionalProperties: false }
  ),
  'jobs.reindex': Type.Object(
    {
      collectionId: id,
      requestId: id,
      documentIds: Type.Optional(Type.Array(id, { minItems: 1, maxItems: 100, uniqueItems: true })),
    },
    { additionalProperties: false }
  ),
  'jobs.get': Type.Object({ id }, { additionalProperties: false }),
  'jobs.cancel': Type.Object({ id }, { additionalProperties: false }),
  'jobs.retry': Type.Object({ id, expectedAttempt: revision }, { additionalProperties: false }),
  search: Type.Object(
    {
      collectionIds: Type.Array(id, { minItems: 1, maxItems: 20, uniqueItems: true }),
      query: Type.String({ minLength: 1, maxLength: 2000 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    },
    { additionalProperties: false }
  ),
  read: Type.Object({ citationId: id }, { additionalProperties: false }),
  'settings.get': Type.Object({}, { additionalProperties: false }),
  'settings.save': Type.Object({ revision, config: model }, { additionalProperties: false }),
  'settings.probe': Type.Object({ config: model }, { additionalProperties: false }),
};
const contextSchema = Type.Object(
  {
    principal: id,
    workspaceId: Type.Optional(id),
    agentSessionId: Type.Optional(id),
    globalWrite: Type.Boolean(),
    modelAccess: Type.Union([Type.Literal('none'), Type.Literal('invoke'), Type.Literal('manage')]),
  },
  { additionalProperties: false }
);

export type KnowledgeCommand = {
  [K in keyof KnowledgeOperations]: {
    operation: K;
    input: KnowledgeOperations[K]['input'];
    context: KnowledgeContext;
  };
}[keyof KnowledgeOperations];

/**
 * Validate untrusted JSON before dispatch; API keys and Host context cannot leak through unknown properties.
 */
export function parseKnowledgeCommand(value: unknown): KnowledgeCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KnowledgeError('INVALID_INPUT', '知识服务请求无效');
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.operation !== 'string' ||
    !Object.hasOwn(operationSchemas, raw.operation) ||
    !Check(contextSchema, raw.context) ||
    !Check(operationSchemas[raw.operation as keyof KnowledgeOperations], raw.input) ||
    Object.keys(raw).some((key) => !['operation', 'input', 'context'].includes(key))
  ) {
    throw new KnowledgeError('INVALID_INPUT', '知识服务参数无效');
  }
  return value as KnowledgeCommand;
}
