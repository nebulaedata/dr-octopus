/**
 * @author Codex
 * @description Verifies safe Workspace reference resolution and private Pi prompt serialization.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createWorkspaceReferencePromptSuffix } from '../dist/modules/channel/channel.utils.js';
import { WorkspacesService } from '../dist/modules/workspaces/workspaces.service.js';

test('Workspace references remain relative, normalized, ordered, and duplicate-free', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-workspace-reference-'));
  const server = Fastify();
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'a.ts'), 'export {};');
  const service = new WorkspacesService({
    workspaceBackend: {
      resolve: async () => ({ id: 'workspace-a', cwd: root }),
    },
  });

  try {
    const references = await service.resolveReferences('workspace-a', [
      { kind: 'file', path: 'src\\a.ts' },
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'directory', path: 'src' },
    ]);
    assert.deepEqual(references, [
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'directory', path: 'src' },
    ]);

    const suffix = createWorkspaceReferencePromptSuffix('request-"a', references);
    assert.match(suffix, /<host_workspace_reference_request id="request-&quot;a" \/>/);
    assert.match(suffix, /<reference kind="file" path="src\/a\.ts" \/>/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Workspace reference resolution rejects stale, absolute, traversal, and mismatched paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-workspace-reference-invalid-'));
  const server = Fastify();
  await mkdir(join(root, 'folder'));
  const service = new WorkspacesService({
    workspaceBackend: {
      resolve: async () => ({ id: 'workspace-a', cwd: root }),
    },
  });

  try {
    await assert.rejects(service.resolveReferences('workspace-a', [{ kind: 'file', path: 'missing.ts' }]), {
      code: 'WORKSPACE_REFERENCE_STALE',
    });
    await assert.rejects(service.resolveReferences('workspace-a', [{ kind: 'file', path: root }]), {
      code: 'WORKSPACE_REFERENCE_PATH_INVALID',
    });
    await assert.rejects(service.resolveReferences('workspace-a', [{ kind: 'file', path: '../outside.ts' }]));
    await assert.rejects(service.resolveReferences('workspace-a', [{ kind: 'file', path: 'folder' }]), {
      code: 'WORKSPACE_REFERENCE_KIND_MISMATCH',
    });
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
