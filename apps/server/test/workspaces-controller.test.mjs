/**
 * @author GitHub Copilot
 * @description Verifies Workspace filesystem HTTP routes registered by the unified controller.
 */

import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { registerWorkspacesController } from '../dist/modules/workspaces/workspaces.controller.js';

/**
 * Mounts the isolated Workspace controller at its production API prefix.
 */
function registerWorkspaceApi(server, service) {
  /**
   * Declares the Fastify plugin boundary required for prefix encapsulation.
   */
  server.register(
    function workspaceApi(apiServer, _options, done) {
      registerWorkspacesController(apiServer, service);
      done();
    },
    { prefix: '/api' }
  );
}

test('POST /files creates an entry and returns 201', async () => {
  const server = Fastify();
  const calls = [];
  registerWorkspaceApi(server, {
    async listEntries() {
      return [];
    },
    async createEntry(workspaceId, relativePath, type) {
      calls.push(['create', workspaceId, relativePath, type]);
      return { name: 'notes.md', path: relativePath, type };
    },
    async deleteEntries() {},
    async writeUploadedFile() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async prepareDownload() {
      return { kind: 'file', absolutePath: '/tmp/x', filename: 'x' };
    },
  });

  const response = await server.inject({
    method: 'POST',
    url: '/api/workspaces/workspace-a/files',
    payload: { path: 'notes.md', type: 'file' },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().entry, { name: 'notes.md', path: 'notes.md', type: 'file' });
  assert.deepEqual(calls, [['create', 'workspace-a', 'notes.md', 'file']]);
  await server.close();
});

test('DELETE /files removes the given batch of paths', async () => {
  const server = Fastify();
  const calls = [];
  registerWorkspaceApi(server, {
    async listEntries() {
      return [];
    },
    async createEntry() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async deleteEntries(workspaceId, relativePaths) {
      calls.push(['delete', workspaceId, relativePaths]);
    },
    async writeUploadedFile() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async prepareDownload() {
      return { kind: 'file', absolutePath: '/tmp/x', filename: 'x' };
    },
  });

  const response = await server.inject({
    method: 'DELETE',
    url: '/api/workspaces/workspace-a/files',
    payload: { paths: ['a.txt', 'dir/b.txt'] },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().deleted, ['a.txt', 'dir/b.txt']);
  assert.deepEqual(calls, [['delete', 'workspace-a', ['a.txt', 'dir/b.txt']]]);
  await server.close();
});

test('POST /files/upload stores a Base64 payload under the target directory', async () => {
  const server = Fastify();
  const calls = [];
  registerWorkspaceApi(server, {
    async listEntries() {
      return [];
    },
    async createEntry() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async deleteEntries() {},
    async writeUploadedFile(workspaceId, relativeDir, name, base64Data) {
      calls.push(['upload', workspaceId, relativeDir, name, base64Data]);
      return { name, path: relativeDir ? `${relativeDir}/${name}` : name, type: 'file' };
    },
    async prepareDownload() {
      return { kind: 'file', absolutePath: '/tmp/x', filename: 'x' };
    },
  });

  const response = await server.inject({
    method: 'POST',
    url: '/api/workspaces/workspace-a/files/upload',
    payload: { path: 'docs', name: 'image.png', data: 'ZmFrZQ==' },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().entry, { name: 'image.png', path: 'docs/image.png', type: 'file' });
  assert.deepEqual(calls, [['upload', 'workspace-a', 'docs', 'image.png', 'ZmFrZQ==']]);
  await server.close();
});

test('GET /files/content reads an editable text file', async () => {
  const server = Fastify();
  const calls = [];
  registerWorkspaceApi(server, {
    async readFileContent(workspaceId, relativePath) {
      calls.push(['read', workspaceId, relativePath]);
      return '# Notes';
    },
  });

  const response = await server.inject({
    method: 'GET',
    url: '/api/workspaces/workspace-a/files/content?path=docs%2Fnotes.md',
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { content: '# Notes' });
  assert.deepEqual(calls, [['read', 'workspace-a', 'docs/notes.md']]);
  await server.close();
});

test('PUT /files/content saves the complete text buffer', async () => {
  const server = Fastify();
  const calls = [];
  registerWorkspaceApi(server, {
    async updateFileContent(workspaceId, relativePath, content) {
      calls.push(['write', workspaceId, relativePath, content]);
    },
  });

  const response = await server.inject({
    method: 'PUT',
    url: '/api/workspaces/workspace-a/files/content',
    payload: { path: 'src/index.ts', content: 'export {};' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { saved: true });
  assert.deepEqual(calls, [['write', 'workspace-a', 'src/index.ts', 'export {};']]);
  await server.close();
});

test('GET /files/download streams a file with an attachment content-disposition header', async () => {
  const server = Fastify();
  registerWorkspaceApi(server, {
    async listEntries() {
      return [];
    },
    async createEntry() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async deleteEntries() {},
    async writeUploadedFile() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async prepareDownload(workspaceId, relativePath) {
      assert.equal(workspaceId, 'workspace-a');
      assert.equal(relativePath, 'src/index.ts');
      return { kind: 'file', absolutePath: import.meta.filename, filename: 'index.ts' };
    },
  });

  const response = await server.inject({
    method: 'GET',
    url: '/api/workspaces/workspace-a/files/download?path=src%2Findex.ts',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.match(response.headers['content-disposition'], /attachment; filename="index\.ts"/);
  await server.close();
});

test('GET /files/download streams a zip archive for directory downloads', async () => {
  const server = Fastify();
  registerWorkspaceApi(server, {
    async listEntries() {
      return [];
    },
    async createEntry() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async deleteEntries() {},
    async writeUploadedFile() {
      return { name: 'x', path: 'x', type: 'file' };
    },
    async prepareDownload() {
      const stream = new PassThrough();
      stream.end('zip-bytes');
      return { kind: 'zip', stream, filename: 'src.zip' };
    },
  });

  const response = await server.inject({
    method: 'GET',
    url: '/api/workspaces/workspace-a/files/download?path=src',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.match(response.headers['content-disposition'], /attachment; filename="src\.zip"/);
  assert.equal(response.body, 'zip-bytes');
  await server.close();
});
