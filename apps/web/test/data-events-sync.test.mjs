/**
 * @author Codex
 * @description Exercises Query race compensation, scope selection and event coalescing using real Query observers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createDataEventsSync, matchesDataChange } from '../src/queries/data-events-sync.ts';
import { parseDataChange } from '../src/queries/data-events-lifecycle.ts';

/**
 * Await a deterministic condition with a short test-only deadline.
 */
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await delay(10);
  assert.ok(predicate());
}

test('scope selection covers scheduler catalog/global history without touching Conversation', () => {
  assert.equal(matchesDataChange(['snapshot', 'w', 's']), false);
  assert.equal(matchesDataChange(['sessions', 'x'], { resource: 'sessions', workspaceId: 'w' }), false);
  assert.equal(
    matchesDataChange(['scheduled-tasks', 'catalog', '', 'all'], { resource: 'scheduler', workspaceId: 'w' }),
    true
  );
  assert.equal(
    matchesDataChange(['scheduled-tasks', 'x', 'history'], { resource: 'scheduler', workspaceId: 'w' }),
    false
  );
  assert.equal(
    matchesDataChange(['notifications', 'inbox'], { resource: 'notifications', workspaceId: 'w' }),
    true
  );
  for (const input of [
    '{',
    'null',
    '{"resource":"bad"}',
    '{"resource":["sessions"]}',
    '{"resource":"sessions","workspaceId":1}',
  ])
    assert.equal(parseDataChange(input), undefined);
});

test('event during first fetch cancels stale response and trailing event triggers a fresh pass', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests = [];
  const observer = new QueryObserver(client, {
    queryKey: ['sessions', 'w'],
    queryFn: ({ signal }) =>
      new Promise((resolve) => {
        requests.push({ resolve, signal });
      }),
  });
  const off = observer.subscribe(() => {});
  const sync = createDataEventsSync(client, 1);
  try {
    assert.equal(requests.length, 1);
    sync.invalidate({ resource: 'sessions', workspaceId: 'w' });
    await until(() => requests.length === 2);
    assert.equal(requests[0].signal.aborted, true);
    requests[0].resolve('stale');
    sync.invalidate({ resource: 'sessions', workspaceId: 'w' });
    requests[1].resolve('intermediate');
    await until(() => requests.length === 3);
    requests[2].resolve('current');
    await until(() => client.getQueryData(['sessions', 'w']) === 'current');
    await delay(30);
    assert.equal(requests.length, 3);
  } finally {
    sync.close();
    off();
    client.clear();
  }
});

test('ready batches refresh only active business queries; closed queue cannot issue requests', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let calls = 0;
  const observer = new QueryObserver(client, { queryKey: ['notifications'], queryFn: async () => ++calls });
  const off = observer.subscribe(() => {});
  const sync = createDataEventsSync(client, 5);
  try {
    await until(() => calls === 1);
    for (let i = 0; i < 50; i++) sync.invalidate();
    await until(() => calls === 2);
    await delay(30);
    assert.equal(calls, 2);
    sync.invalidate();
    sync.close();
    await delay(30);
    assert.equal(calls, 2);
  } finally {
    sync.close();
    off();
    client.clear();
  }
});

test('Scheduler availability is refreshed before task queries and a stopped daemon is not queried', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let ready = true;
  let calls = 0;
  const service = new QueryObserver(client, {
    queryKey: ['scheduler-service'],
    queryFn: async () => ({ state: ready ? 'control-ready' : 'stopped' }),
  });
  const tasks = new QueryObserver(client, { queryKey: ['scheduled-tasks'], queryFn: async () => ++calls });
  const offService = service.subscribe(() => {});
  const offTasks = tasks.subscribe(() => {});
  const sync = createDataEventsSync(client, 1);
  try {
    await until(() => calls === 1 && client.getQueryData(['scheduler-service']));
    ready = false;
    sync.invalidate({ resource: 'scheduler' });
    await until(() => client.getQueryData(['scheduler-service']).state === 'stopped');
    await delay(30);
    assert.equal(calls, 1);
    assert.equal(client.getQueryState(['scheduled-tasks']).isInvalidated, true);
    ready = true;
    sync.invalidate({ resource: 'scheduler' });
    await until(() => calls === 2);
  } finally {
    sync.close();
    offService();
    offTasks();
    client.clear();
  }
});
