/**
 * @author Codex
 * @description Verifies ordinary work-mode forwarding and Agent-owned knowledge state projection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeCommands } from '../dist/lib/runtime/commands.js';
import { RuntimeEventProjection } from '../dist/lib/runtime/event-projection.js';
import { decodeClientMessage } from '../dist/modules/channel/message.decoder.js';

test('ordinary control exits the current workflow, forwards config and verifies Agent projection', async () => {
  let state = { available: true, workMode: 'plan', phase: 'planning', awaitingAction: false };
  const calls = [];
  const target = {
    binding: {},
    execute: async (command) => {
      if (command.type === 'get_commands') {
        return {
          success: true,
          data: {
            commands: [
              { name: 'plan', source: 'extension' },
              { name: 'knowledge', source: 'extension' },
            ],
          },
        };
      }
      if (command.message === '/knowledge status') {
        return { success: true };
      }
      calls.push(command.message);
      if (command.message.startsWith('/knowledge config ')) {
        state = { ...state, knowledge: JSON.parse(command.message.slice('/knowledge config '.length)) };
      }
      if (command.message === '/plan exit' || command.message === '/knowledge off') {
        state = { ...state, workMode: 'agent' };
      }
      if (command.message === '/knowledge on') {
        state = { ...state, workMode: 'knowledge' };
      }
      if (command.message === '/plan start') {
        state = { ...state, workMode: 'plan' };
      }
      return { success: true };
    },
  };
  const commands = new RuntimeCommands({
    withRuntime: async (_id, fn) => fn(target),
    readPlanModeState: () => state,
  });
  assert.equal(
    (await commands.executeWorkModeControl('s', 'knowledge', {}, { collectionIds: [] })).workMode,
    'knowledge'
  );
  assert.deepEqual(calls, ['/plan exit', '/knowledge config {"collectionIds":[]}', '/knowledge on']);
  calls.length = 0;
  await commands.executeWorkModeControl('s', 'plan');
  assert.deepEqual(calls, ['/knowledge off', '/plan start']);
});

test('live mode arrives before JSONL flush and recovery invalidates prior generation', () => {
  let publish;
  const projection = new RuntimeEventProjection({
    onEvent: (fn) => {
      publish = fn;
      return () => {};
    },
  });
  const state = { version: 1, enabled: true, collectionIds: [], model: null, restoreTools: ['private'] };
  publish({
    type: 'extension-ui',
    sessionId: 's',
    payload: { method: 'setStatus', statusKey: 'octopus-knowledge-mode', statusText: JSON.stringify(state) },
    sequence: 1,
  });
  assert.equal(projection.getKnowledgeMode('s').enabled, true);
  assert.ok(!('restoreTools' in projection.getKnowledgeMode('s')));
  assert.ok(!('model' in projection.getKnowledgeMode('s')));
  publish({ type: 'runtime-state', sessionId: 's', payload: { state: 'recovering' }, sequence: 2 });
  assert.equal(projection.getKnowledgeMode('s'), undefined);
  projection.close();
});

test('channel accepts collection-only config, discards legacy model fields and rejects invalid scope', () => {
  const message = {
    type: 'agent.set-work-mode',
    requestId: 'r',
    sessionId: 's',
    payload: { mode: 'knowledge', knowledge: { collectionIds: [] } },
  };
  assert.equal(decodeClientMessage(JSON.stringify(message)).payload.mode, 'knowledge');
  message.payload.knowledge.model = { provider: 'legacy', id: 'answer' };
  assert.deepEqual(decodeClientMessage(JSON.stringify(message)).payload.knowledge, { collectionIds: [] });
  message.payload.knowledge.collectionIds = Array(21).fill('x');
  assert.throws(() => decodeClientMessage(JSON.stringify(message)));
});
