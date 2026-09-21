/**
 * @author Codex
 * @description Verifies permission Settings HTTP scope isolation, inheritance, malformed input and revision conflicts.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import Fastify from 'fastify';
import { PermissionSettingsService } from '../dist/modules/settings/permission-settings.service.js';
import { registerPermissionSettingsController } from '../dist/modules/settings/permission-settings.controller.js';

test('permission Settings supports registered workspace overlays and rejects stale or malformed writes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-permission-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new PermissionSettingsService(join(root, 'agent'), {
    resolve: async ({ id }) => {
      if (id !== 'demo') throw Object.assign(new Error('Unknown workspace'), { statusCode: 404 });
      return { cwd: join(root, 'workspace') };
    },
  });
  const app = Fastify();
  t.after(() => app.close());
  registerPermissionSettingsController(app, service);
  const read = await app.inject('/settings/permissions');
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers['cache-control'], 'no-store');
  const saved = await app.inject({
    method: 'PUT',
    url: '/settings/permissions',
    payload: { revision: read.json().revision, config: { policy: { tools: { demo: 'deny' } } } },
  });
  assert.equal(saved.statusCode, 200);
  const workspace = (await app.inject('/settings/permissions?workspaceId=demo')).json();
  assert.equal(workspace.effective.policy.tools.demo, 'deny');
  const local = await app.inject({
    method: 'PUT',
    url: '/settings/permissions?workspaceId=demo',
    payload: { revision: workspace.revision, config: { policy: { tools: { demo: 'ask' } } } },
  });
  assert.equal(local.statusCode, 200);
  assert.equal(local.json().effective.policy.tools.demo, 'ask');
  assert.equal((await app.inject('/settings/permissions')).json().effective.policy.tools.demo, 'deny');
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/settings/permissions',
        payload: { revision: read.json().revision, config: {} },
      })
    ).statusCode,
    409
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/settings/permissions',
        payload: { revision: saved.json().revision, config: { modes: { full: { external: 'sometimes' } } } },
      })
    ).statusCode,
    400
  );
  assert.equal((await app.inject('/settings/permissions?workspaceId=missing')).statusCode, 404);
  assert.equal((await app.inject('/settings/permissions?cwd=/arbitrary/path')).statusCode, 400);
});
