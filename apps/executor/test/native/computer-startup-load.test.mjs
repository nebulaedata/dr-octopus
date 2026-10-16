/**
 * @author Codex
 * @description Exercises bounded private Computer handshake alongside one real Node inventory verification without desktop actions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeResources } from '../../src/runtime/basic/node-resources.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));

test(
  'real private handshake completes during one overlapping Node resource verification and confirms Job exit',
  { timeout: 60000 },
  async () => {
    const { createComputerBackend } = createRequire(import.meta.url)(
      join(dist, 'runtime/computer-backend.cjs')
    );
    const owner = createComputerBackend(dist);
    const native = new NativeFileCommit(join(dist, 'native/file-commit.node'));
    // The fixture selects its own build inventory; this is not a disk-derived product trust anchor.
    const digest = createHash('sha256')
      .update(await readFile(join(dist, 'node-resources.json')))
      .digest('hex');
    try {
      const checks = NodeResources.open(dist, native, digest);
      const startup = owner.connect();
      const [checked, connected] = await Promise.allSettled([checks, startup]);
      assert.equal(checked.status, 'fulfilled', checked.reason?.message);
      assert.equal(connected.status, 'fulfilled', connected.reason?.message);
      assert.equal(connected.value.supportsProductContract(), true);
      assert.equal(connected.value.readStatus().computerAvailable, false);
      assert.deepEqual(await owner.close(), { executionStopConfirmed: true });
    } finally {
      await owner.close();
    }
  }
);
