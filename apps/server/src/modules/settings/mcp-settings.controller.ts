/**
 * @author Codex
 * @description Registers Settings MCP Server configuration endpoints.
 * - GET /api/settings/mcp-servers
 * - POST /api/settings/mcp-servers/connectivity-probe
 * - POST /api/settings/mcp-servers/:serverKey/connectivity-probe
 * - GET /api/settings/mcp-servers/:serverKey
 * - POST /api/settings/mcp-servers
 * - PUT /api/settings/mcp-servers/:serverKey
 * - PATCH /api/settings/mcp-servers/:serverKey/activation
 * - DELETE /api/settings/mcp-servers/:serverKey
 */

import {
  CreateMcpServerBodySchema,
  DeleteMcpServerBodySchema,
  McpServerKeySchema,
  UpdateMcpServerActivationBodySchema,
  UpdateMcpServerBodySchema,
} from '@octopus/shared/protocol';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { MutationIdempotencyLedger, mutationFingerprint } from '../../lib/idempotency/mutation-ledger.js';
import type { FastifyInstance } from 'fastify';
import type { McpSettingsService } from './mcp-settings.service.js';

interface McpServerParams {
  serverKey: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Registers MCP Settings routes against the Host application service.
 */
export function registerMcpSettingsController(server: FastifyInstance, service: McpSettingsService): void {
  const mutations = new MutationIdempotencyLedger();
  server.get('/settings/mcp-servers', () => service.list());
  server.post('/settings/mcp-servers/connectivity-probe', () => service.probeConnectivity());
  server.post<{ Params: McpServerParams }>('/settings/mcp-servers/:serverKey/connectivity-probe', (request) =>
    service.probeConnectivity(parseServerKey(request.params.serverKey))
  );
  server.get<{ Params: McpServerParams }>('/settings/mcp-servers/:serverKey', (request) => {
    return service.get(parseServerKey(request.params.serverKey));
  });
  server.post('/settings/mcp-servers', async (request, reply) => {
    const body = parseBody(CreateMcpServerBodySchema, request.body);
    const result = await executeMutation(
      mutations,
      request.headers['idempotency-key'],
      'create',
      body.name,
      body,
      () => service.create(body)
    );
    return reply.status(201).send(result);
  });
  server.put<{ Params: McpServerParams }>('/settings/mcp-servers/:serverKey', async (request) => {
    const serverKey = parseServerKey(request.params.serverKey);
    const body = parseBody(UpdateMcpServerBodySchema, request.body);
    return executeMutation(mutations, request.headers['idempotency-key'], 'update', serverKey, body, () =>
      service.update(serverKey, body)
    );
  });
  server.patch<{ Params: McpServerParams }>(
    '/settings/mcp-servers/:serverKey/activation',
    async (request) => {
      const serverKey = parseServerKey(request.params.serverKey);
      const body = parseBody(UpdateMcpServerActivationBodySchema, request.body);
      return executeMutation(
        mutations,
        request.headers['idempotency-key'],
        'activation',
        serverKey,
        body,
        () => service.setActivation(serverKey, body)
      );
    }
  );
  server.delete<{ Params: McpServerParams }>('/settings/mcp-servers/:serverKey', async (request) => {
    const serverKey = parseServerKey(request.params.serverKey);
    const body = parseBody(DeleteMcpServerBodySchema, request.body);
    return executeMutation(mutations, request.headers['idempotency-key'], 'remove', serverKey, body, () =>
      service.remove(serverKey, body.revision)
    );
  });
}

/** Parses one schema-backed request body. */
function parseBody<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest('The MCP Settings request is malformed.');
  }
  return parsed.data;
}

/** Validates one opaque Server route key. */
function parseServerKey(value: string): string {
  const parsed = McpServerKeySchema.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest('The MCP Server key is malformed.');
  }
  return parsed.data;
}

/** Executes one idempotent Settings mutation. */
function executeMutation<T>(
  ledger: MutationIdempotencyLedger,
  header: string | string[] | undefined,
  type: string,
  scope: string,
  body: unknown,
  operation: () => Promise<T>
): Promise<T> {
  const key = typeof header === 'string' && UUID.test(header) ? header : undefined;
  if (key === undefined) {
    throw invalidRequest('Idempotency-Key must be a UUID.');
  }
  return ledger.execute({ scope, key, type, fingerprint: mutationFingerprint(body) }, operation);
}

/** Creates the stable request validation error. */
function invalidRequest(message: string): ApplicationError {
  return new ApplicationError('INVALID_SETTINGS_REQUEST', message, { statusCode: 400 });
}
