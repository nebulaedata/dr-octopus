/**
 * @author Codex
 * @description Verifies runtime decoding and transport-safe error projection for browser commands.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { toPublicError } from '../dist/infrastructure/errors/public-error.js';
import { SessionRuntimeError } from '../dist/infrastructure/runtime/index.js';
import { decodeClientMessage } from '../dist/modules/channel/channel.dto.js';

test('Session channel decoder rejects unknown and structurally invalid commands', () => {
  assert.throws(() => decodeClientMessage('{'));
  assert.throws(() =>
    decodeClientMessage(JSON.stringify({ type: 'agent.prompt', requestId: 'r', sessionId: 's' }))
  );
  assert.throws(() => decodeClientMessage(JSON.stringify({ type: 'unknown', requestId: 'r' })));
  assert.equal(decodeClientMessage(JSON.stringify({ type: 'ping', requestId: 'r' })).type, 'ping');
});

test('Session channel decoder validates command-specific payload fields', () => {
  const target = { requestId: 'r', sessionId: 's' };

  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({
        ...target,
        type: 'agent.prompt',
        payload: { message: 'hello', attachmentIds: ['valid', 1] },
      })
    )
  );
  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({
        ...target,
        type: 'agent.set-permission-mode',
        payload: { mode: 'unrestricted' },
      })
    )
  );
  assert.equal(
    decodeClientMessage(
      JSON.stringify({ ...target, type: 'agent.set-permission-mode', payload: { mode: 'auto' } })
    ).type,
    'agent.set-permission-mode'
  );
  assert.equal(
    decodeClientMessage(JSON.stringify({ ...target, type: 'agent.set-work-mode', payload: { mode: 'plan' } }))
      .type,
    'agent.set-work-mode'
  );
  assert.equal(
    decodeClientMessage(
      JSON.stringify({ ...target, type: 'agent.set-work-mode', payload: { mode: 'knowledge' } })
    ).type,
    'agent.set-work-mode'
  );
  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({ ...target, type: 'agent.set-work-mode', payload: { mode: 'unsupported' } })
    )
  );
  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({
        ...target,
        type: 'agent.prompt',
        payload: { message: 'hello', workspaceReferences: [{ kind: 'file', path: '' }] },
      })
    )
  );
  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({
        ...target,
        type: 'agent.prompt',
        payload: { message: 'hello', workspaceReferences: [{ kind: 'link', path: 'src/a.ts' }] },
      })
    )
  );
  const referencedPrompt = decodeClientMessage(
    JSON.stringify({
      ...target,
      type: 'agent.prompt',
      payload: {
        message: 'hello',
        workspaceReferences: [{ kind: 'file', path: 'src/a.ts' }],
      },
    })
  );
  assert.deepEqual(referencedPrompt.payload.workspaceReferences, [{ kind: 'file', path: 'src/a.ts' }]);
  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({
        ...target,
        type: 'agent.set-thinking',
        payload: { level: 'ultra' },
      })
    )
  );
  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({
        ...target,
        type: 'agent.set-queue-mode',
        payload: { queue: 'invalid', mode: 'all' },
      })
    )
  );
  assert.throws(() =>
    decodeClientMessage(
      JSON.stringify({
        ...target,
        type: 'extension.ui.response',
        payload: { extensionRequestId: 'extension-request', cancelled: false },
      })
    )
  );
});

test('public error projection hides internal server messages', () => {
  const projected = toPublicError(Object.assign(new Error('C:\\private\\secret.txt'), { statusCode: 500 }));
  assert.equal(projected.message, 'The server could not complete the request.');
  assert.equal(projected.retryable, true);
});

test('Session absence and runtime retirement have distinct public retry semantics', () => {
  const missing = toPublicError(
    new SessionRuntimeError('SESSION_NOT_FOUND', 'Session was not found: session-a')
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.retryable, false);
  assert.equal(missing.code, 'SESSION_NOT_FOUND');

  const stale = toPublicError(
    new SessionRuntimeError('SESSION_RUNTIME_STALE', 'Runtime generation retired.')
  );
  assert.equal(stale.statusCode, 503);
  assert.equal(stale.retryable, true);
  assert.equal(stale.code, 'SESSION_RUNTIME_STALE');
  assert.equal(stale.message, 'The server could not complete the request.');
});
