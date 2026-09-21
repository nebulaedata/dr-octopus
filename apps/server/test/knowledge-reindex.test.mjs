/**
 * @author Codex
 * @description Guards scoped HTTP indexing requests against silently becoming full-collection rebuilds.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerKnowledgeController } from '../dist/modules/knowledge/knowledge.controller.js';

test('global and workspace routes preserve explicit selections including invalid empty input', async (t) => {
  const server = Fastify();
  const calls = [];
  registerKnowledgeController(server, {
    call: async (workspaceId, operation, input) => {
      calls.push({ workspaceId, operation, input });
      return { id: 'job' };
    },
  });
  t.after(() => server.close());
  for (const [base, workspaceId] of [
    ['/knowledge/global', undefined],
    ['/workspaces/workspace-1/knowledge', 'workspace-1'],
  ]) {
    for (const selection of [undefined, [], ['document-1', 'document-2']]) {
      const payload = {
        requestId: 'request',
        ...(selection !== undefined ? { documentIds: selection } : {}),
      };
      const response = await server.inject({
        method: 'POST',
        url: `${base}/collections/collection-1/reindex`,
        payload,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls.at(-1), {
        workspaceId,
        operation: 'jobs.reindex',
        input: { collectionId: 'collection-1', ...payload },
      });
    }
  }
});
