/**
 * @author Codex
 * @description Verifies bounded restart history retains active records and never evicts a replayable operation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RestartHistory } from '../dist/infrastructure/lifecycle/operations.js';

test('history refuses overflow until terminal TTL expires and preserves active operations', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const history = new RestartHistory();
  for (let index = 0; index < 100; index++) {
    history.assertCapacity();
    history.add(String(index), {
      body: { revision: 'a', expectedServiceInstanceId: 'instance' },
      operation: {
        operationId: String(index),
        state: index === 0 ? 'starting' : 'succeeded',
        completedAt: index === 0 ? null : new Date().toISOString(),
      },
      handoff() {},
    });
  }
  assert.throws(() => history.assertCapacity(), { code: 'SERVER_RESTART_HISTORY_FULL' });
  assert.equal(history.get('99').state, 'succeeded');
  const detached = history.get('0');
  detached.state = 'failed';
  assert.equal(history.get('0').state, 'starting');
  t.mock.timers.tick(600_001);
  assert.doesNotThrow(() => history.assertCapacity());
  assert.equal(history.get('0').state, 'starting');
  assert.throws(() => history.get('99'), { code: 'SERVER_RESTART_OPERATION_NOT_FOUND' });
});
