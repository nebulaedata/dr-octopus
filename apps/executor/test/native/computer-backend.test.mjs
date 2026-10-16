/**
 * @author Codex
 * @description Exercises real private Computer startup without an inventory or native digest addon, plus owner shutdown without desktop input.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputerBackend } from '../../src/runtime/computer/computer-backend.ts';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));

test('owner refuses relative configuration and a closed owner cannot start or reopen', async () => {
  assert.throws(() => new ComputerBackend('relative'), /RESOURCE_PATH_REJECTED/);
  const owner = new ComputerBackend(dist);
  assert.deepEqual(await owner.close(), { executionStopConfirmed: true });
  await assert.rejects(owner.connect(), /BACKEND_CLOSED/);
  assert.deepEqual(await owner.close(), { executionStopConfirmed: true });
});

test('missing fixed launcher fails at spawn, never falls back and leaves no process to stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-computer-missing-'));
  const owner = new ComputerBackend(root);
  try {
    await mkdir(join(root, 'resources/computer'), { recursive: true });
    await assert.rejects(owner.connect(), /WINDOWS_MCP_CONNECTION_FAILED/);
    assert.deepEqual(await owner.close(), { executionStopConfirmed: true });
    await assert.rejects(owner.connect(), /BACKEND_CLOSED/);
  } finally {
    await owner.close();
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-computer-missing-')));
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'built owner starts without a resource inventory or digest addon and coalesces real MCP startup',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-computer-no-preflight-'));
    const resource = join(root, 'resources/computer');
    let linked = false;
    let owner;
    try {
      await mkdir(join(root, 'native'));
      await mkdir(join(root, 'resources'));
      await copyFile(
        join(dist, 'native/computer-supervisor.exe'),
        join(root, 'native/computer-supervisor.exe')
      );
      // Borrow only the fixed interpreter tree; the temporary root has neither inventory nor file-commit.node.
      await symlink(join(dist, 'resources/computer'), resource, 'junction');
      linked = true;
      const { createComputerBackend } = createRequire(import.meta.url)(
        join(dist, 'runtime/computer-backend.cjs')
      );
      owner = createComputerBackend(root);
      const first = owner.connect();
      assert.equal(owner.connect(), first);
      const connection = await first;
      assert.equal(connection.supportsProductContract(), true);
      assert.equal(connection.readStatus().computerAvailable, false);
      assert.deepEqual(await owner.close(), { executionStopConfirmed: true });
      await assert.rejects(owner.connect(), /BACKEND_CLOSED/);
    } finally {
      await owner?.close();
      // Remove the junction itself before recursively cleaning only the owned temporary root.
      if (linked) {
        await unlink(resource);
      }
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-computer-no-preflight-')));
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
);

test(
  'private backend imports Schema resources beyond MAX_PATH and confirms its deep-path Job exit',
  { timeout: 60000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'octopus-computer-deep-'));
    const root = join(temporary, 'owned-installation-'.repeat(6));
    const resource = join(root, 'resources/computer');
    let linked = false;
    const owner = new ComputerBackend(root);
    try {
      await mkdir(join(root, 'native'), { recursive: true });
      await mkdir(join(root, 'resources'));
      await copyFile(
        join(dist, 'native/computer-supervisor.exe'),
        join(root, 'native/computer-supervisor.exe')
      );
      await symlink(join(dist, 'resources/computer'), resource, 'junction');
      linked = true;
      assert.ok(
        join(resource, 'Lib/site-packages/jsonschema_specifications/schemas/draft201909/metaschema.json')
          .length > 260
      );
      const connection = await owner.connect();
      assert.equal(connection.supportsProductContract(), true);
      assert.deepEqual(await owner.close(), { executionStopConfirmed: true });
    } finally {
      await owner.close();
      if (linked) {
        await unlink(resource);
      }
      assert.ok(temporary.startsWith(join(tmpdir(), 'octopus-computer-deep-')));
      await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
);
