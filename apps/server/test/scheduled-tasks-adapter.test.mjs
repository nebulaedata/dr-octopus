/**
 * @author Codex
 * @description Verifies the Server scheduler module only maps trusted identities and forwards Agent SDK calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ScheduledTasksService } from '../dist/modules/scheduled-tasks/scheduled-tasks.service.js';

const task = {
  id: 'task-a',
  workspaceId: 'workspace-a',
  originSessionRef: 'pi-session-a',
  executionMode: 'isolated-run',
  name: 'Daily check',
  description: '',
  prompt: 'Report progress',
  schedule: { type: 'interval', everyMs: 60_000, anchorAt: '2026-09-05T00:00:00.000Z' },
  enabled: true,
  misfirePolicy: 'coalesce',
  overlapPolicy: 'queue-one',
  timeoutMs: 60_000,
  revision: 1,
  nextRunAt: '2026-09-05T00:01:00.000Z',
  pausedAt: null,
  deletedAt: null,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

const readyStatus = {
  protocol: 2,
  profileId: 'profile-a',
  daemonId: 'daemon-a',
  port: 41234,
  pid: 1234,
  state: 'control-ready',
  taskControlReady: true,
  executionReady: true,
  active: true,
  degraded: false,
  lastScanAt: '2026-09-05T00:00:00.000Z',
  queued: 2,
  running: 1,
  nextRunAt: '2026-09-05T00:01:00.000Z',
};

/**
 * Create a deterministic adapter fixture without starting a Scheduler daemon or model runtime.
 */
function setup() {
  const calls = [];
  let closes = 0;
  const client = {
    async list(caller, limit, offset) {
      calls.push(['list', caller, limit, offset]);
      return { items: [task], limit, offset };
    },
    async get(id, caller) {
      calls.push(['get', id, caller]);
      return task;
    },
    async history(id, caller, limit, offset) {
      calls.push(['history', id, caller, limit, offset]);
      return { items: [], limit, offset };
    },
    async request(request, caller) {
      calls.push(['request', request, caller]);
      if (request.operation === 'list') {
        return { items: [task], ...request.input };
      }
      if (request.operation === 'history') {
        return { items: [], ...request.input };
      }
      return { effect: 'saved', task, warnings: [] };
    },
    close() {
      closes += 1;
    },
  };
  const created = [];
  const service = new ScheduledTasksService({
    agentDir: 'agent-profile',
    workspaces: {
      async list() {
        return [{ id: 'workspace-a' }];
      },
      async resolve() {
        return {
          id: 'workspace-a',
          cwd: 'D:\\workspace-a',
          updatedAt: 'revision-a',
        };
      },
    },
    sessions: {
      async resolveAgentSessionRef(workspaceId, sessionId) {
        assert.equal(workspaceId, 'workspace-a');
        assert.equal(sessionId, 'web-session-a');
        return 'pi-session-a';
      },
      findSessionIdByAgentRef(workspaceId, agentSessionId) {
        return workspaceId === 'workspace-a' && agentSessionId === 'pi-session-a' ? 'web-session-a' : null;
      },
    },
    createClient(options) {
      created.push(options);
      return client;
    },
    async readStatus(agentDir) {
      return { state: 'stopped', agentDir };
    },
    async startService(agentDir) {
      return { ...readyStatus, action: 'start', agentDir };
    },
    async stopService(agentDir) {
      return { state: 'stopped', action: 'stop', agentDir };
    },
    async restartService(agentDir) {
      return { ...readyStatus, action: 'restart', agentDir };
    },
    async readSettings() {
      return {
        timezone: 'Asia/Shanghai',
        maxConcurrentRuns: 3,
        revision: 1,
        updatedAt: '2026-09-05T00:00:00.000Z',
      };
    },
    async updateSettings(_agentDir, input) {
      return { ...input, revision: input.revision + 1, updatedAt: '2026-09-06T00:00:00.000Z' };
    },
  });
  return { service, client, calls, created, getCloses: () => closes };
}

test('missing task authority is a client permission error, while unavailable authority remains retryable', async () => {
  const { service, client } = setup();
  for (const [code, statusCode] of [
    ['SCHEDULE_AUTHORIZATION_REQUIRED', 403],
    ['SCHEDULE_AUTHORIZATION_UNAVAILABLE', 503],
  ]) {
    client.get = async () => {
      throw Object.assign(new Error('Authorize this task before running it'), { code });
    };
    await assert.rejects(service.get({ workspaceId: 'workspace-a' }, 'task-a'), { code, statusCode });
  }
  service.close();
});

test('adapter maps Agent task ownership back to the Web Session catalog', async () => {
  const { service, calls, created } = setup();
  const page = await service.list({ workspaceId: 'workspace-a' }, { limit: 20, offset: 0 });
  assert.equal(page.items[0].targetSessionId, 'web-session-a');
  assert.equal('originSessionRef' in page.items[0], false);
  assert.deepEqual(calls[0], [
    'request',
    { operation: 'list', input: { limit: 20, offset: 0, status: 'all', q: '' } },
    {},
  ]);
  assert.deepEqual(created[0], {
    agentDir: 'agent-profile',
    workspaceId: 'workspace-a',
    cwd: 'D:\\workspace-a',
    configRevision: 'revision-a',
  });
  service.close();
});

test('catalog validates filters and preserves explicit workspace scope', async () => {
  const { service, calls } = setup();
  const result = await service.catalog({ status: 'archived', q: 'check', offset: 0, limit: 21 });
  assert.equal(result.items[0].targetSessionId, 'web-session-a');
  assert.equal(calls[0][1].input.status, 'archived');
  assert.equal(calls[0][1].input.q, 'check');
  assert.equal(calls[0][1].input.limit, 100);
  await service.catalog({ workspaceId: 'workspace-a', offset: 20, limit: 21 });
  assert.equal(calls[1][1].input.offset, 20);
  assert.equal(calls[1][1].input.limit, 21);
  await assert.rejects(service.catalog({ workspaceId: ['a', 'b'] }), { code: 'SCHEDULE_INVALID' });
  await assert.rejects(service.catalog({ offset: -1 }), { code: 'SCHEDULE_INVALID' });
  service.close();
});

test('creation cannot be forwarded by the page adapter', async () => {
  const { service, calls } = setup();
  await assert.rejects(
    service.mutate(
      { workspaceId: 'workspace-a' },
      {
        operation: 'create',
        key: 'mutation-a',
        targetSessionId: 'web-session-a',
        input: {
          name: 'Daily check',
          prompt: 'Report progress',
          schedule: { type: 'once', at: '2026-09-06T00:00:00.000Z' },
        },
      }
    ),
    { code: 'SCHEDULE_INVALID' }
  );
  assert.deepEqual(calls, []);
  service.close();
});

test('lifecycle controls the Agent daemon while close only releases adapter resources', async () => {
  const { service, getCloses } = setup();
  await service.get({ workspaceId: 'workspace-a' }, 'task-a');
  assert.deepEqual(await service.status(), { state: 'stopped' });
  assert.deepEqual(await service.control('start'), {
    state: 'control-ready',
    taskControlReady: true,
    executionReady: true,
    active: true,
    degraded: false,
    lastScanAt: '2026-09-05T00:00:00.000Z',
    queued: 2,
    running: 1,
    nextRunAt: '2026-09-05T00:01:00.000Z',
  });
  assert.deepEqual(await service.control('stop'), { state: 'stopped' });
  assert.deepEqual(await service.control('restart'), {
    state: 'control-ready',
    taskControlReady: true,
    executionReady: true,
    active: true,
    degraded: false,
    lastScanAt: '2026-09-05T00:00:00.000Z',
    queued: 2,
    running: 1,
    nextRunAt: '2026-09-05T00:01:00.000Z',
  });
  assert.equal((await service.settings()).timezone, 'Asia/Shanghai');
  assert.deepEqual(await service.updateSettings({ timezone: 'UTC', maxConcurrentRuns: 5, revision: 1 }), {
    timezone: 'UTC',
    maxConcurrentRuns: 5,
    revision: 2,
    updatedAt: '2026-09-06T00:00:00.000Z',
  });
  service.close();
  service.close();
  assert.equal(getCloses(), 1);
});
