/**
 * @author Codex
 * @description Verifies that concurrent Agent process identities write isolated permission review shards.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getPermissionReviewLogDirectory } from '../dist/extensions/permission-system/index.js';
import { FilePermissionReviewLogger } from '../dist/extensions/permission-system/lib/file-permission-review-logger.js';

test('distinct Agent process identities never share a writable permission log segment', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-review-shards-'));
  const agentDir = join(temporaryRoot, 'agent');
  const createLogger = (processId, instanceId) =>
    new FilePermissionReviewLogger(agentDir, {
      processStartedAt: 1788582000000,
      processId,
      instanceId,
      isProcessAlive: () => true,
    });
  const firstLogger = createLogger(14320, 'a81f2c4d');
  const secondLogger = createLogger(20544, 'b12e8a91');

  try {
    assert.equal(
      firstLogger.write(
        'permission_request.allowed',
        { requestId: 'request-first', toolName: 'read', resolution: 'policy_allowed' },
        1_000
      ),
      undefined
    );
    assert.equal(
      secondLogger.write(
        'permission_request.blocked',
        { requestId: 'request-second', toolName: 'bash', resolution: 'policy_denied' },
        1_000
      ),
      undefined
    );

    const logsDir = getPermissionReviewLogDirectory(agentDir);
    const filenames = (await readdir(logsDir)).sort();
    assert.deepEqual(filenames, [
      'permission-review.1788582000000-14320-a81f2c4d.000.jsonl',
      'permission-review.1788582000000-20544-b12e8a91.000.jsonl',
    ]);
    const requestIds = [];
    for (const filename of filenames) {
      requestIds.push(JSON.parse(await readFile(join(logsDir, filename), 'utf8')).requestId);
    }
    assert.deepEqual(requestIds, ['request-first', 'request-second']);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
