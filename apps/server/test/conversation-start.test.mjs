/**
 * @author Codex
 * @description Exercises cold-start admission, durable idempotency, model intent and non-replaying recovery.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '../dist/db/client.js';
import { ConversationStartRepository } from '../dist/modules/sessions/conversation-start.repository.js';
import { ConversationStartService } from '../dist/modules/sessions/conversation-start.service.js';

/**
 * Creates isolated persistent ownership with an observable deterministic RPC boundary.
 */
function fixture(t) {
  const database = createDatabase(':memory:');
  const repository = new ConversationStartRepository(database);
  const models = [
    { provider: 'p', id: 'one' },
    { provider: 'p', id: 'two' },
  ];
  let defaultId = 'one';
  let version = '1';
  let prepares = 0;
  let deliveries = 0;
  let publications = 0;
  let workMode = async () => {};
  let selected;
  const controls = [];
  const changes = [];
  let dispatch = async () => {
    deliveries++;
  };
  let prepare = async () => {};
  const dependencies = {
    repository,
    onChanged: (workspaceId) => changes.push(workspaceId),
    configuration: async () => version,
    assertWorkspace: async () => {},
    attachments: { releasePrompt() {} },
    settings: {
      listDefaultModelCandidates: async () => ({
        candidates: models.map((m) => ({
          providerId: m.provider,
          modelId: m.id,
          modelName: m.id,
          input: ['text'],
          reasoning: false,
        })),
      }),
      getDefaultModel: async () => ({
        providerId: 'p',
        modelId: defaultId,
        configured: true,
        available: true,
      }),
    },
    sessions: {
      prepareDraftSession: async () => {
        prepares++;
        await prepare();
        return { runtime: { runtimeId: 'r', epoch: 1 } };
      },
      executeThinkingControl: async (_id, command) => {
        if (command.type === 'set_model') selected = { provider: command.provider, id: command.modelId };
        else {
          controls.push(['thinking', command.level]);
          return { level: command.level };
        }
      },
      execute: async () => ({ type: 'response', success: true, data: { model: selected } }),
      executePermissionControl: async (_id, mode) => {
        controls.push(['permission', mode]);
      },
      executeWorkModeControl: async (_id, mode, binding, knowledge) => {
        controls.push(['workMode', mode]);
        if (knowledge) controls.push(['knowledge', knowledge]);
        await workMode(mode, knowledge, binding);
      },
      getSession: () => ({ provider: 'p', model: 'one' }),
      activate: async () => ({ runtimeId: 'r', epoch: 1 }),
      publishDraftSession() {
        publications++;
      },
      deleteSession: async () => {},
    },
    channel: {
      prepareFirstMessage: async (message) => ({ type: 'prompt', message: message.payload.message }),
      dispatchFirstMessage: async () => dispatch(),
    },
  };
  const service = new ConversationStartService(dependencies);
  t.after(async () => {
    await service.close();
    database.sqlite.close();
  });
  const input = () => ({
    submissionId: randomUUID(),
    draftId: randomUUID(),
    draftVersion: 1,
    message: 'First question',
    attachmentIds: [],
    workspaceReferences: [],
    selection: { mode: 'follow-default' },
  });
  return {
    service,
    dependencies,
    workMode: (fn) => {
      workMode = fn;
    },
    publications: () => publications,
    repository,
    input,
    selected: () => selected,
    controls,
    changes,
    prepares: () => prepares,
    deliveries: () => deliveries,
    default: (id) => {
      defaultId = id;
    },
    version: (value) => {
      version = value;
    },
    dispatch: (fn) => {
      dispatch = fn;
    },
    prepare: (fn) => {
      prepare = fn;
    },
  };
}
/**
 * Waits for a bounded state transition without issuing another submission.
 */
async function settled(service, id) {
  for (let i = 0; i < 100; i++) {
    const value = service.get('w', id);
    if (!['preparing', 'accepted', 'dispatching'].includes(value.status)) return value;
    await delay(5);
  }
  throw new Error('Operation did not settle');
}

test('model catalog is independent of Agent startup and default is resolved at send time', async (t) => {
  const f = fixture(t);
  await f.service.catalog();
  assert.equal(f.prepares(), 0);
  f.default('two');
  const input = f.input();
  await f.service.start('w', input);
  assert.equal((await settled(f.service, input.submissionId)).status, 'running');
  assert.deepEqual(f.selected(), { provider: 'p', id: 'two' });
});

test('explicit model selection survives a changed default', async (t) => {
  const f = fixture(t);
  f.default('two');
  const input = { ...f.input(), selection: { mode: 'explicit', provider: 'p', modelId: 'one' } };
  await f.service.start('w', input);
  await settled(f.service, input.submissionId);
  assert.equal(f.selected().id, 'one');
});

test('concurrent submission and lost-response retry retain one session and one delivery', async (t) => {
  const f = fixture(t);
  const input = f.input();
  const results = await Promise.all([f.service.start('w', input), f.service.start('w', input)]);
  assert.equal(results[0].sessionId, results[1].sessionId);
  await settled(f.service, input.submissionId);
  await f.service.start('w', input);
  assert.ok(f.changes.length >= 3);
  assert.ok(f.changes.every((workspaceId) => workspaceId === 'w'));
  assert.equal(f.prepares(), 1);
  assert.equal(f.deliveries(), 1);
  await assert.rejects(f.service.start('w', { ...input, message: 'Different' }), {
    code: 'CONVERSATION_START_CONFLICT',
  });
  const duplicateTab = await f.service.start('w', { ...input, submissionId: randomUUID() });
  assert.equal(duplicateTab.submissionId, input.submissionId);
  assert.equal(f.deliveries(), 1);
  await assert.rejects(
    f.service.start('w', { ...input, submissionId: randomUUID(), message: 'Different tab input' }),
    { code: 'CONVERSATION_START_CONFLICT' }
  );
  assert.throws(() => f.service.get('another-workspace', input.submissionId), {
    code: 'CONVERSATION_START_NOT_FOUND',
  });
});

test('missing model fails before process creation and preserves saved content', async (t) => {
  const f = fixture(t);
  f.default('missing');
  const input = f.input();
  await f.service.start('w', input);
  const result = await settled(f.service, input.submissionId);
  assert.equal(result.status, 'failed');
  assert.equal(result.message, input.message);
  assert.equal(f.prepares(), 0);
  f.default('one');
  const retry = { ...input, submissionId: randomUUID() };
  await f.service.start('w', retry);
  assert.equal((await settled(f.service, retry.submissionId)).status, 'running');
});

test('configuration mutation during startup cannot dispatch with an obsolete snapshot', async (t) => {
  const f = fixture(t);
  f.prepare(async () => {
    f.version('2');
  });
  const input = f.input();
  await f.service.start('w', input);
  assert.equal((await settled(f.service, input.submissionId)).status, 'failed');
  assert.equal(f.deliveries(), 0);
});

test('cancellation before acceptance never publishes a prompt', async (t) => {
  const f = fixture(t);
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  f.prepare(() => waiting);
  const input = f.input();
  await f.service.start('w', input);
  await delay(10);
  assert.equal(f.service.cancel('w', input.submissionId).status, 'cancelled');
  release();
  await delay(10);
  assert.equal(f.deliveries(), 0);
});

test('uncertain delivery survives recovery without replaying and preserves its receipt', async (t) => {
  const f = fixture(t);
  let attempts = 0;
  f.dispatch(async () => {
    attempts++;
    throw new Error('Reply lost after dispatch');
  });
  const input = f.input();
  await f.service.start('w', input);
  const result = await settled(f.service, input.submissionId);
  assert.equal(result.status, 'unknown');
  f.repository.recover();
  await f.service.start('w', input);
  assert.equal(attempts, 1);
  assert.equal(f.service.receipt('w', result.sessionId).message, input.message);
});

test('crash recovery distinguishes accepted outbox entries from uncertain dispatches', (t) => {
  const f = fixture(t);
  const preparing = f.repository.claim('w', f.input());
  const accepted = f.repository.claim('w', f.input());
  const dispatching = f.repository.claim('w', f.input());
  f.repository.set(accepted.submissionId, 'accepted');
  f.repository.set(dispatching.submissionId, 'dispatching');
  f.repository.recover();
  assert.equal(f.repository.get(preparing.submissionId).status, 'failed');
  assert.equal(f.repository.get(preparing.submissionId).activeDraftId, null);
  assert.equal(f.repository.get(accepted.submissionId).status, 'accepted');
  assert.equal(f.repository.accepted().length, 1);
  assert.equal(f.repository.get(dispatching.submissionId).status, 'unknown');
  assert.equal(f.repository.get(dispatching.submissionId).activeDraftId, dispatching.draftId);
});

test('first-turn preferences are applied before dispatch without any browser runtime commands', async (t) => {
  const f = fixture(t);
  const input = {
    ...f.input(),
    controls: { permissionMode: 'full', thinkingLevel: 'high', workMode: 'plan' },
  };
  await f.service.start('w', input);
  assert.equal((await settled(f.service, input.submissionId)).status, 'running');
  assert.deepEqual(f.controls, [
    ['permission', 'full'],
    ['thinking', 'high'],
    ['workMode', 'plan'],
  ]);
});

for (const scope of [undefined, { collectionIds: ['workspace-source', 'global-source'] }]) {
  test(`knowledge scope ${scope ? 'selected' : 'automatic'} is applied before publication and dispatch`, async (t) => {
    const f = fixture(t);
    const knowledge = scope ?? { collectionIds: [] };
    const input = {
      ...f.input(),
      controls: { workMode: 'knowledge', ...(scope ? { knowledge: scope } : {}) },
    };
    f.dispatch(async () => {
      assert.deepEqual(f.controls, [
        ['workMode', 'knowledge'],
        ['knowledge', knowledge],
      ]);
      assert.equal(f.publications(), 1);
    });
    await f.service.start('w', input);
    assert.equal((await settled(f.service, input.submissionId)).status, 'running');
    assert.deepEqual(f.repository.get(input.submissionId).request.controls, input.controls);
    await assert.rejects(
      f.service.start('w', {
        ...input,
        controls: { workMode: 'knowledge', knowledge: { collectionIds: ['different'] } },
      }),
      { code: 'CONVERSATION_START_CONFLICT' }
    );
  });
}

test('failed knowledge configuration never publishes or dispatches and preserves scope for explicit retry', async (t) => {
  const f = fixture(t);
  const input = {
    ...f.input(),
    controls: { workMode: 'knowledge', knowledge: { collectionIds: ['retained-source'] } },
  };
  f.workMode(async () => {
    throw new Error('Knowledge extension unavailable or scope rejected');
  });
  await f.service.start('w', input);
  assert.equal((await settled(f.service, input.submissionId)).status, 'failed');
  assert.equal(f.deliveries(), 0);
  assert.equal(f.publications(), 0);
  assert.deepEqual(f.repository.get(input.submissionId).request.controls, input.controls);
  f.workMode(async () => {});
  const retry = { ...input, submissionId: randomUUID() };
  await f.service.start('w', retry);
  assert.equal((await settled(f.service, retry.submissionId)).status, 'running');
  assert.equal(f.deliveries(), 1);
});

test('accepted startup recovery reapplies saved knowledge scope before dispatch', async (t) => {
  const f = fixture(t);
  const input = {
    ...f.input(),
    controls: { workMode: 'knowledge', knowledge: { collectionIds: ['saved-source'] } },
  };
  f.repository.claim('w', input);
  f.repository.set(input.submissionId, 'accepted');
  await f.service.close();
  const resumed = new ConversationStartService(f.dependencies);
  try {
    assert.equal((await settled(resumed, input.submissionId)).status, 'running');
    assert.deepEqual(f.controls, [
      ['workMode', 'knowledge'],
      ['knowledge', input.controls.knowledge],
    ]);
    assert.equal(f.deliveries(), 1);
  } finally {
    await resumed.close();
  }
});

test('cancellation during knowledge activation prevents acceptance and delivery', async (t) => {
  const f = fixture(t);
  let entered;
  let release;
  const entry = new Promise((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  f.workMode(async () => {
    entered();
    await waiting;
  });
  const input = {
    ...f.input(),
    controls: { workMode: 'knowledge', knowledge: { collectionIds: ['source'] } },
  };
  await f.service.start('w', input);
  await entry;
  assert.equal(f.service.cancel('w', input.submissionId).status, 'cancelled');
  release();
  await f.service.close();
  assert.equal(f.deliveries(), 0);
  assert.equal(f.publications(), 0);
  assert.deepEqual(f.repository.get(input.submissionId).request.controls, input.controls);
});

test('only definitive unsent receipts expose complete draft recovery context', async (t) => {
  const f = fixture(t);
  f.default('missing');
  const input = {
    ...f.input(),
    attachmentIds: ['attachment'],
    workspaceReferences: [{ path: 'README.md', kind: 'file' }],
    controls: { workMode: 'knowledge', knowledge: { collectionIds: ['source'] } },
  };
  await f.service.start('w', input);
  const failed = await settled(f.service, input.submissionId);
  assert.deepEqual(failed.draft, input);
  assert.deepEqual(f.service.receipt('w', failed.sessionId).draft, input);
  for (const status of ['preparing', 'accepted', 'dispatching', 'running', 'unknown']) {
    f.repository.set(input.submissionId, status);
    assert.equal(f.service.get('w', input.submissionId).draft, undefined);
  }
});
