/**
 * @author Codex
 * @description Verifies permission mode changes use the registered Pi slash command over JSONL RPC.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRuntimePermissionState,
  setRuntimePermissionMode,
} from '../dist/infrastructure/runtime/index.js';

test('permission runtime adapter executes the registered slash command over Pi RPC', async () => {
  const requests = [];
  const transport = {
    async execute(request) {
      requests.push(request);
      return {
        type: 'response',
        command: 'prompt',
        success: true,
      };
    },
  };

  assert.deepEqual(await setRuntimePermissionMode(transport, 'auto'), {
    mode: 'auto',
    scope: 'runtime-generation',
    persisted: false,
  });
  assert.deepEqual(requests, [{ type: 'prompt', message: '/permission-mode auto' }]);
});

test('permission runtime adapter rejects a mismatched correlated response', async () => {
  await assert.rejects(
    () =>
      setRuntimePermissionMode(
        {
          async execute() {
            return { type: 'response', command: 'get_state', success: true, data: {} };
          },
        },
        'full'
      ),
    {
      code: 'SESSION_RUNTIME_STALE',
      message: 'Agent returned an invalid permission command response.',
    }
  );
});

test('permission runtime state is a non-persisted process-generation projection', () => {
  assert.deepEqual(createRuntimePermissionState('ask'), {
    mode: 'ask',
    scope: 'runtime-generation',
    persisted: false,
  });
});
