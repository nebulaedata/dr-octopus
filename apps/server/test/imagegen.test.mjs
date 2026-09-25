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
import { registerSettingsController } from '../dist/modules/model-settings/model-settings.controller.js';
import { WorkspacesService } from '../dist/modules/workspaces/workspaces.service.js';
import { registerWorkspacesController } from '../dist/modules/workspaces/workspaces.controller.js';

const config = { providerId: 'custom', modelId: 'image-model', adapter: 'openai-images' };

test('image settings routes validate, save and clear independently', async (t) => {
  let current = null;
  let available = true;
  const service = new SettingsService({
    listImagegenCandidates: async () => [
      {
        ...config,
        name: 'Image',
        providerName: 'Custom',
        available,
        supportsReferenceImages: true,
        requiresProtocolConfirmation: true,
      },
    ],
    getImagegenSettings: async () => ({
      config: current,
      available: available && current !== null,
      effect: 'next_call',
    }),
    saveImagegenSettings: async (value) => {
      current = value;
    },
  });
  const app = Fastify();
  t.after(() => app.close());
  registerSettingsController(app, service);
  assert.equal(
    (await app.inject({ method: 'PUT', url: '/settings/imagegen', payload: config })).statusCode,
    200
  );
  assert.deepEqual((await app.inject('/settings/imagegen')).json().config, config);
  assert.equal(
    (await app.inject({ method: 'PUT', url: '/settings/imagegen', payload: { ...config, adapter: 'chat' } }))
      .statusCode,
    400
  );
  available = false;
  await assert.rejects(service.saveImagegenSettings(config), { code: 'IMAGEGEN_MODEL_UNAVAILABLE' });
  assert.equal((await app.inject('/settings/imagegen')).json().available, false);
  assert.equal((await app.inject({ method: 'DELETE', url: '/settings/imagegen' })).json().config, null);
});

test('a provider owning the image default cannot be deleted', async () => {
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
    getImagegenSettings: async () => ({ config }),
    deleteCustomProvider: async () => {
      deleted = true;
    },
  });
  const key = (await service.listProviders()).providers[0].providerKey;
  await assert.rejects(service.deleteCustomProvider(key), { code: 'MODEL_PROVIDER_DEFAULT_IN_USE' });
  assert.equal(deleted, false);
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
