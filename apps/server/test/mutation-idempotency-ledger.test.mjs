/**
 * @author Codex
 * @description Verifies bounded mutation single-flight, result replay, conflicts, and capacity backpressure.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MutationIdempotencyLedger,
  mutationFingerprint,
} from '../dist/infrastructure/idempotency/mutation-ledger.js';

test('mutation ledger single-flights pending work and replays its settled result', async () => {
  const ledger = new MutationIdempotencyLedger();
  let executions = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const identity = {
    scope: 'session-a',
    key: 'request-a',
    type: 'agent.prompt',
    fingerprint: mutationFingerprint({ message: 'hello', options: { b: 2, a: 1 } }),
  };
  const operation = async () => {
    executions += 1;
    await gate;
    return { accepted: true };
  };

  const first = ledger.execute(identity, operation);
  const duplicate = ledger.execute(identity, operation);
  release();
  assert.deepEqual(await Promise.all([first, duplicate]), [{ accepted: true }, { accepted: true }]);
  assert.deepEqual(await ledger.execute(identity, operation), { accepted: true });
  assert.equal(executions, 1);
});

test('mutation ledger rejects key reuse with a different canonical payload', async () => {
  const ledger = new MutationIdempotencyLedger();
  await ledger.execute(
    { scope: 'session-a', key: 'request-a', type: 'preferences', fingerprint: '{"a":1}' },
    async () => undefined
  );
  assert.throws(
    () =>
      ledger.execute(
        { scope: 'session-a', key: 'request-a', type: 'preferences', fingerprint: '{"a":2}' },
        async () => undefined
      ),
    { code: 'MUTATION_IDEMPOTENCY_CONFLICT', statusCode: 409 }
  );
});

test('mutation ledger applies backpressure rather than evicting pending ownership', async () => {
  const ledger = new MutationIdempotencyLedger({ maxEntries: 1 });
  let release;
  const pending = ledger.execute(
    { scope: 'session-a', key: 'request-a', type: 'prompt', fingerprint: '{}' },
    async () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  await Promise.resolve();
  assert.throws(
    () =>
      ledger.execute(
        { scope: 'session-a', key: 'request-b', type: 'prompt', fingerprint: '{}' },
        async () => undefined
      ),
    { code: 'MUTATION_IDEMPOTENCY_CAPACITY', statusCode: 429 }
  );
  release();
  await pending;
});
