/**
 * @author Codex
 * @description Verifies image settings validation, deletion protection and workspace preview boundaries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import Fastify from 'fastify';
import { SettingsService } from '../dist/modules/model-settings/model-settings.service.js';
import { registerImagegenSettingsController } from '../dist/modules/imagegen-settings/imagegen-settings.controller.js';
import { WorkspacesService } from '../dist/modules/workspaces/workspaces.service.js';
import { registerWorkspacesController } from '../dist/modules/workspaces/workspaces.controller.js';

test('image settings have independent credentials, redacted responses and revision validation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-image-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = Fastify();
  t.after(() => app.close());
  registerImagegenSettingsController(app, directory);
  const current = (await app.inject('/settings/imagegen')).json();
  assert.equal(current.enabled, false);
  const payload = {
    revision: current.revision,
    enabled: true,
    provider: {
      id: 'openai',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-image-1.5',
      apiKey: 'private-key',
    },
  };
  const saved = await app.inject({ method: 'PUT', url: '/settings/imagegen', payload });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().providers.openai.hasApiKey, true);
  assert.equal(saved.body.includes('private-key'), false);
  for (const baseUrl of [
    'not a url',
    'https://user:secret@example.test/v1',
    'https://example.test/v1?key=secret',
  ]) {
    const invalid = await app.inject({
      method: 'PUT',
      url: '/settings/imagegen',
      payload: { ...payload, revision: saved.json().revision, provider: { ...payload.provider, baseUrl } },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.includes('private-key'), false);
  }
  assert.equal((await app.inject({ method: 'PUT', url: '/settings/imagegen', payload })).statusCode, 409);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/settings/imagegen',
        payload: { revision: saved.json().revision, activeProvider: 'google' },
      })
    ).statusCode,
    400
  );
  assert.equal((await app.inject('/settings/imagegen/candidates')).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/settings/imagegen' })).statusCode, 404);
});

test('independent image configuration does not prevent deleting a chat provider', async () => {
  let deleted = false;
  const service = new SettingsService({
    listProviders: async () => [
      {
        id: 'custom',
        name: 'Custom',
        local: { runtime: 'openai-compatible' },
        provenance: 'models_json',
        auth: { configured: true },
        models: [],
        endpointOwned: true,
      },
    ],
    getDefaultModel: async () => ({}),
    deleteCustomProvider: async () => {
      deleted = true;
      return { changed: true, synchronized: true };
    },
  });
  const key = (await service.listProviders()).providers[0].providerKey;
  await service.deleteCustomProvider(key);
  assert.equal(deleted, true);
});

test('workspace previews validate image bytes, missing files and junction boundaries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-preview-'));
  const outside = await mkdtemp(join(tmpdir(), 'octopus-preview-outside-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000000' } })
    .png()
    .toBuffer();
  await writeFile(join(root, 'image.png'), bytes);
  await writeFile(join(root, 'bad.png'), '<svg></svg>');
  await writeFile(join(outside, 'private.png'), bytes);
  await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const service = new WorkspacesService({ workspaceBackend: { resolve: async () => ({ cwd: root }) } });
  const app = Fastify();
  t.after(() => app.close());
  registerWorkspacesController(app, service);
  const response = await app.inject('/workspaces/w/files/image?path=image.png');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(response.rawPayload, bytes);
  await assert.rejects(service.readImage('w', 'missing.png'), { code: 'WORKSPACE_FILE_NOT_FOUND' });
  await assert.rejects(service.readImage('w', 'bad.png'), { code: 'WORKSPACE_IMAGE_UNSUPPORTED' });
  await assert.rejects(service.readImage('w', 'escape/private.png'), { code: 'WORKSPACE_FILE_PATH_INVALID' });
});
