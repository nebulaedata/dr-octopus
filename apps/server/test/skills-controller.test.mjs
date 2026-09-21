/**
 * @author Claude Code
 * @description Verifies Global and Workspace scope Skill HTTP routes registered by the Skills controller.
 */

import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { registerSkillsController } from '../dist/modules/skills/skills.controller.js';

const GLOBAL = { kind: 'global' };
const WORKSPACE = { kind: 'workspace', workspaceId: 'ws-1' };

/**
 * Mounts the isolated Skills controller at its production API prefix.
 */
function registerSkillsApi(server, service) {
  const effectiveSkillsService = {
    async list(workspaceId, runtimeId) {
      service.calls.push(['listEffective', workspaceId, runtimeId]);
      return {
        consistency: runtimeId === undefined ? 'resolved' : 'runtime',
        generation: 'abc',
        skills: [],
        diagnostics: [],
      };
    },
  };
  server.register(
    function skillsApi(apiServer, _options, done) {
      registerSkillsController(apiServer, service, effectiveSkillsService);
      done();
    },
    { prefix: '/api' }
  );
}

/**
 * Builds a stub service recording every call for assertion.
 */
function createServiceStub(detail) {
  const calls = [];
  return {
    calls,
    async list(scope) {
      calls.push(['list', scope]);
      return { root: '/skills-root', skills: [] };
    },
    async get(scope, name) {
      calls.push(['get', scope, name]);
      return detail;
    },
    async create(scope, input) {
      calls.push(['create', scope, input]);
      return detail;
    },
    async update(scope, name, input) {
      calls.push(['update', scope, name, input]);
      return detail;
    },
    async remove(scope, name) {
      calls.push(['remove', scope, name]);
    },
    async upload(scope, input) {
      calls.push(['upload', scope, input]);
      return detail;
    },
  };
}

const DETAIL = {
  name: 'code-review',
  description: 'Reviews code changes.',
  disableModelInvocation: false,
  warnings: [],
  fileCount: 1,
  sizeBytes: 64,
  updatedAt: '2026-08-22T00:00:00.000Z',
  body: '# Code Review',
  files: [{ path: 'SKILL.md', sizeBytes: 64 }],
};

test('GET /skills lists the Global Skill catalog', async () => {
  const server = Fastify();
  const stub = createServiceStub(DETAIL);
  registerSkillsApi(server, stub);

  const response = await server.inject({ method: 'GET', url: '/api/skills' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { root: '/skills-root', skills: [] });
  assert.deepEqual(stub.calls, [['list', GLOBAL]]);
  await server.close();
});

test('POST /skills creates a Skill and returns 201', async () => {
  const server = Fastify();
  const stub = createServiceStub(DETAIL);
  registerSkillsApi(server, stub);

  const response = await server.inject({
    method: 'POST',
    url: '/api/skills',
    payload: { name: 'code-review', description: 'Reviews code changes.', body: '# Code Review' },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(stub.calls, [
    ['create', GLOBAL, { name: 'code-review', description: 'Reviews code changes.', body: '# Code Review' }],
  ]);
  assert.equal(response.json().skill.name, 'code-review');
  await server.close();
});

test('PUT /skills/:name forwards the route identity and editable fields', async () => {
  const server = Fastify();
  const stub = createServiceStub(DETAIL);
  registerSkillsApi(server, stub);

  const response = await server.inject({
    method: 'PUT',
    url: '/api/skills/code-review',
    payload: { description: 'New summary.', disableModelInvocation: true, body: 'New body.' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(stub.calls, [
    [
      'update',
      GLOBAL,
      'code-review',
      { description: 'New summary.', disableModelInvocation: true, body: 'New body.' },
    ],
  ]);
  await server.close();
});

test('DELETE /skills/:name removes the Skill and echoes the identity', async () => {
  const server = Fastify();
  const stub = createServiceStub(DETAIL);
  registerSkillsApi(server, stub);

  const response = await server.inject({ method: 'DELETE', url: '/api/skills/code-review' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { deleted: 'code-review' });
  assert.deepEqual(stub.calls, [['remove', GLOBAL, 'code-review']]);
  await server.close();
});

test('POST /skills/upload forwards the archive payload and returns 201', async () => {
  const server = Fastify();
  const stub = createServiceStub(DETAIL);
  registerSkillsApi(server, stub);

  const response = await server.inject({
    method: 'POST',
    url: '/api/skills/upload',
    payload: { filename: 'bundle.zip', data: 'ZmFrZQ==', overwrite: true },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(stub.calls, [
    ['upload', GLOBAL, { filename: 'bundle.zip', data: 'ZmFrZQ==', overwrite: true }],
  ]);
  await server.close();
});

test('workspace routes forward the Workspace scope derived from the route', async () => {
  const server = Fastify();
  const stub = createServiceStub(DETAIL);
  registerSkillsApi(server, stub);

  const listResponse = await server.inject({ method: 'GET', url: '/api/workspaces/ws-1/skills' });
  assert.equal(listResponse.statusCode, 200);

  const detailResponse = await server.inject({
    method: 'GET',
    url: '/api/workspaces/ws-1/skills/code-review',
  });
  assert.equal(detailResponse.statusCode, 200);
  assert.equal(detailResponse.json().skill.name, 'code-review');

  const createResponse = await server.inject({
    method: 'POST',
    url: '/api/workspaces/ws-1/skills',
    payload: { name: 'code-review', description: 'Reviews code changes.', body: '# Code Review' },
  });
  assert.equal(createResponse.statusCode, 201);

  const updateResponse = await server.inject({
    method: 'PUT',
    url: '/api/workspaces/ws-1/skills/code-review',
    payload: { description: 'New summary.', body: 'New body.' },
  });
  assert.equal(updateResponse.statusCode, 200);

  const deleteResponse = await server.inject({
    method: 'DELETE',
    url: '/api/workspaces/ws-1/skills/code-review',
  });
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(deleteResponse.json(), { deleted: 'code-review' });

  const uploadResponse = await server.inject({
    method: 'POST',
    url: '/api/workspaces/ws-1/skills/upload',
    payload: { filename: 'bundle.zip', data: 'ZmFrZQ==' },
  });
  assert.equal(uploadResponse.statusCode, 201);

  assert.deepEqual(stub.calls, [
    ['list', WORKSPACE],
    ['get', WORKSPACE, 'code-review'],
    [
      'create',
      WORKSPACE,
      { name: 'code-review', description: 'Reviews code changes.', body: '# Code Review' },
    ],
    ['update', WORKSPACE, 'code-review', { description: 'New summary.', body: 'New body.' }],
    ['remove', WORKSPACE, 'code-review'],
    ['upload', WORKSPACE, { filename: 'bundle.zip', data: 'ZmFrZQ==' }],
  ]);
  await server.close();
});

test('effective Skills route forwards Workspace and optional Runtime identity', async () => {
  const server = Fastify();
  const stub = createServiceStub(DETAIL);
  registerSkillsApi(server, stub);

  const resolved = await server.inject({
    method: 'GET',
    url: '/api/workspaces/ws-1/effective-skills',
  });
  const runtime = await server.inject({
    method: 'GET',
    url: '/api/workspaces/ws-1/effective-skills?runtimeId=runtime-1',
  });

  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().consistency, 'resolved');
  assert.equal(runtime.statusCode, 200);
  assert.equal(runtime.json().consistency, 'runtime');
  assert.deepEqual(stub.calls, [
    ['listEffective', 'ws-1', undefined],
    ['listEffective', 'ws-1', 'runtime-1'],
  ]);
  await server.close();
});
