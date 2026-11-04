/**
 * @author Codex
 * @description Verifies isolated configuration authorities, commit observers and Fastify teardown ordering.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ConfigurationChanges } from '../dist/infrastructure/runtime-config/index.js';
import { configurationChangesPlugin } from '../dist/plugins/configuration-changes.plugin.js';
import { sessionRuntimePlugin } from '../dist/plugins/session-runtime.plugin.js';
import { SessionRuntimeCoordinator } from '../dist/infrastructure/runtime/index.js';

test('commit state survives observers and closed publishers are inert with bounded diagnostics', () => {
  const diagnostics = [];
  const changes = new ConfigurationChanges((code) => diagnostics.push(code));
  const publish = changes.publisher('mcp-servers');
  let observed = 0;
  changes.subscribe(() => {
    throw new Error('private value');
  });
  const unsubscribe = changes.subscribe(() => {
    observed = changes.current();
  });
  publish();
  publish();
  assert.equal(observed, 2);
  assert.deepEqual(diagnostics, ['configuration-observer-failed']);
  unsubscribe();
  unsubscribe();
  changes.close();
  changes.close();
  publish();
  publish();
  assert.equal(changes.current(), 2);
  assert.deepEqual(diagnostics, ['configuration-observer-failed', 'publish-after-close']);
  assert.throws(() => changes.publisher('skills'), /unavailable/);
});

test('Fastify consumers share one authority and release it after consumer teardown', async () => {
  const app = Fastify();
  const changes = new ConfigurationChanges();
  const runtime = new SessionRuntimeCoordinator({ configurationChanges: changes });
  const order = [];
  const closeRuntime = runtime.close.bind(runtime);
  runtime.close = async () => {
    order.push('runtime');
    await closeRuntime();
  };
  const closeChanges = changes.close.bind(changes);
  changes.close = () => {
    order.push('configuration');
    closeChanges();
  };
  app.register(configurationChangesPlugin, { instance: changes });
  app.register(sessionRuntimePlugin, { runtime });
  app.register(async (scope) => {
    assert.equal(scope.configurationChanges, changes);
    scope.configurationChanges.publisher('agent-environment')();
    scope.addHook('onClose', async () => {
      order.push('producer');
    });
  });
  await app.ready();
  assert.equal(changes.current(), 1);
  assert.equal(runtime.getDiagnostics().activeRuntimeCount, 0);
  await app.close();
  assert.deepEqual(order, ['producer', 'runtime', 'configuration']);
});

test('mismatched injected runtime is rejected and separate Servers retain separate authorities', async () => {
  const a = Fastify();
  const b = Fastify();
  a.register(configurationChangesPlugin);
  b.register(configurationChangesPlugin);
  await Promise.all([a.ready(), b.ready()]);
  a.configurationChanges.publisher('mcp-servers')();
  assert.equal(b.configurationChanges.current(), 0);
  const wrong = new SessionRuntimeCoordinator({ configurationChanges: b.configurationChanges });
  const c = Fastify();
  c.register(configurationChangesPlugin);
  c.register(sessionRuntimePlugin, { runtime: wrong });
  await assert.rejects(c.ready(), /authority does not match/);
  await wrong.close();
  assert.doesNotThrow(() => b.configurationChanges.publisher('mcp-servers')());
  await Promise.all([a.close(), b.close(), c.close()]);
});
