/**
 * @author Codex
 * @description Completion coordinator tests for readiness, evidence deduplication, ack and defer policy.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SchedulerResultDelivery } from '../dist/extensions/scheduler/services/result-delivery.js';

/**
 * Produce one safe pending completion record.
 */
function item(overrides = {}) {
  return {
    id: 'delivery-a',
    runId: 'run-a',
    taskId: 'task-a',
    taskName: 'Daily check',
    runStatus: 'succeeded',
    kind: 'run-completed',
    payloadVersion: 1,
    summary: 'Completed.',
    resultRef: 'scheduler-run:run-a',
    createdAt: '2026-09-05T00:00:00.000Z',
    availableAt: '2026-09-05T00:00:00.000Z',
    attempts: 0,
    ...overrides,
  };
}

test('coordinator appends once and acknowledges only verified Session evidence', async () => {
  const acknowledgements = [];
  const evidence = new Map();
  let appends = 0;
  const coordinator = new SchedulerResultDelivery(
    {
      async acquireLease() {
        return { release() {} };
      },
      async listPending() {
        return { items: [item()] };
      },
      async ack(id, entryId) {
        acknowledgements.push([id, entryId]);
        return { id, status: 'delivered', originEntryId: entryId };
      },
      async defer() {
        throw new Error('unexpected defer');
      },
    },
    {
      isReady: () => true,
      findEvidence: (id) => evidence.get(id) ?? null,
      append(delivery) {
        appends += 1;
        evidence.set(delivery.id, 'entry-a');
        return 'entry-a';
      },
    }
  );

  await coordinator.reconcile('test');
  await coordinator.reconcile('replay');
  coordinator.dispose();
  assert.equal(appends, 1);
  assert.deepEqual(acknowledgements, [
    ['delivery-a', 'entry-a'],
    ['delivery-a', 'entry-a'],
  ]);
});

test('busy source Session performs no daemon read or append', async () => {
  let reads = 0;
  const coordinator = new SchedulerResultDelivery(
    {
      async acquireLease() {
        return { release() {} };
      },
      async listPending() {
        reads += 1;
        return { items: [item()] };
      },
      async ack() {
        throw new Error('unexpected ack');
      },
      async defer() {
        throw new Error('unexpected defer');
      },
    },
    {
      isReady: () => false,
      findEvidence: () => null,
      append: () => null,
    }
  );

  await coordinator.reconcile('busy');
  coordinator.dispose();
  assert.equal(reads, 0);
});

test('missing post-append evidence remains pending with bounded backoff', async () => {
  const deferrals = [];
  const coordinator = new SchedulerResultDelivery(
    {
      async acquireLease() {
        return { release() {} };
      },
      async listPending() {
        return { items: [item({ attempts: 2 })] };
      },
      async ack() {
        throw new Error('unexpected ack');
      },
      async defer(id, availableAt, code) {
        deferrals.push([id, availableAt, code]);
        return { id, status: 'pending', originEntryId: null };
      },
    },
    {
      isReady: () => true,
      findEvidence: () => null,
      append: () => null,
    },
    () => Date.parse('2026-09-05T00:00:00.000Z')
  );

  await coordinator.reconcile('test');
  coordinator.dispose();
  assert.deepEqual(deferrals, [
    ['delivery-a', '2026-09-05T00:00:20.000Z', 'SCHEDULE_DELIVERY_EVIDENCE_PENDING'],
  ]);
});

test('another Runtime holding the source Session fence suppresses reads and appends', async () => {
  let reads = 0;
  const coordinator = new SchedulerResultDelivery(
    {
      async acquireLease() {
        return null;
      },
      async listPending() {
        reads += 1;
        return { items: [item()] };
      },
      async ack() {
        throw new Error('unexpected ack');
      },
      async defer() {
        throw new Error('unexpected defer');
      },
    },
    {
      isReady: () => true,
      findEvidence: () => null,
      append: () => {
        throw new Error('unexpected append');
      },
    }
  );

  await coordinator.reconcile('contended');
  coordinator.dispose();
  assert.equal(reads, 0);
});
