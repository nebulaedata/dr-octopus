/**
 * @author Codex
 * @description Verifies workspace identity, durable dev data and disjoint local port ranges without starting an application.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { browserDevelopment } from '../../../scripts/browser-development.mjs';

test('physical workspace aliases share dev identity while generated-directory cleanup cannot remove its data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-browser-development-'));
  try {
    const workspace = join(root, 'workspace');
    const other = join(root, 'other');
    await mkdir(workspace);
    await mkdir(other);
    const alias = join(root, 'alias');
    await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const dev = browserDevelopment(workspace);
    assert.deepEqual(browserDevelopment(alias), dev);
    assert.notEqual(browserDevelopment(other).hostName, dev.hostName);
    assert.equal(dev.userData, join(homedir(), '.dr-octopus/executor-dev', dev.key, 'electron'));
    assert.equal(dev.profile, join(homedir(), '.dr-octopus/executor-dev', dev.key, 'browser'));
    assert(dev.rendererPort >= 41000 && dev.rendererPort < 51000);
    assert(dev.runtimePort >= 30000 && dev.runtimePort < 40000);
    assert(dev.extensionPort >= 52000 && dev.extensionPort < 62000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
