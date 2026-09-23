/**
 * @author Codex
 * @description Verifies entrypoint discovery, route isolation, shared connections, and failed-startup cleanup.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { businessModulesPlugin } from '../dist/plugins/business-modules.plugin.js';
import { createServer } from '../dist/app.js';
import { loadServerConfig } from '../dist/infrastructure/config/config.js';
import { databasePlugin } from '../dist/plugins/database.plugin.js';

/**
 * Creates isolated ESM module fixtures without loading application processes or remote services.
 */
async function fixture(context, files) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-module-loading-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  for (const [name, source] of Object.entries(files)) {
    const path = join(directory, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, source);
  }
  return directory;
}

test('autoload loads module entrypoints once, shares the database, and isolates route hooks', async (t) => {
  const directory = await fixture(t, {
    'index.js': 'throw new Error("root entry must not run");',
    'alpha/index.js': `export default async function (app) {
      app.database.sqlite.prepare('CREATE TABLE calls (value INTEGER)').run();
      app.database.sqlite.prepare('INSERT INTO calls VALUES (1)').run();
      app.addHook('onRequest', async (_request, reply) => { reply.header('x-alpha', 'yes'); });
      app.get('/alpha', async () => app.database.sqlite.prepare('SELECT count(*) AS count FROM calls').get());
      app.addHook('onClose', async () => { app.database.sqlite.prepare('SELECT 1').get(); });
    }`,
    'alpha/alpha.service.js': 'throw new Error("implementation must not run");',
    'alpha/workers/index.js': 'throw new Error("worker must not run");',
    'beta/index.js': `export default async function (app) {
      app.get('/beta', async () => ({ open: app.database.sqlite.open }));
    }`,
    'missing-entry/missing-entry.service.js': 'throw new Error("implementation must not run");',
  });
  const app = Fastify();
  t.after(() => app.close());
  app.register(databasePlugin, { path: ':memory:' });
  app.register(
    async (scope) => {
      await scope.register(businessModulesPlugin, { directory, capabilityLimits: {} });
    },
    { prefix: '/api' }
  );
  const alpha = await app.inject('/api/alpha');
  assert.equal(alpha.statusCode, 200);
  assert.deepEqual(alpha.json(), { count: 1 });
  assert.equal(alpha.headers['x-alpha'], 'yes');
  const beta = await app.inject('/api/beta');
  assert.equal(beta.statusCode, 200);
  assert.deepEqual(beta.json(), { open: true });
  assert.equal(beta.headers['x-alpha'], undefined);
  assert.equal((await app.inject('/api/alpha/alpha')).statusCode, 404);
  const database = app.database;
  await app.close();
  assert.equal(database.sqlite.open, false);
});

test('a module startup failure remains visible and the shared database can be released', async (t) => {
  const directory = await fixture(t, {
    'index.js': 'throw new Error("root entry must not run");',
    'broken/index.js': 'export default async function () { throw new Error("module failed"); }',
  });
  const app = Fastify();
  t.after(() => app.close());
  app.register(databasePlugin, { path: ':memory:' });
  app.register(businessModulesPlugin, { directory, capabilityLimits: {} });
  await assert.rejects(app.ready(), /module failed/);
  const database = app.database;
  await app.close();
  assert.equal(database.sqlite.open, false);
});

test('registration wrappers do not charge cumulative child startup against one plugin timeout', async (t) => {
  const directory = await fixture(t, {
    'index.js': 'throw new Error("root entry must not run");',
    'alpha/index.js': `export default async function alpha(app) {
      await new Promise(resolve => setTimeout(resolve, 350));
      app.get('/alpha', async () => ({ ready: true }));
    }`,
    'beta/index.js': `export default async function beta(app) {
      app.register((scope, _options, done) => {
        scope.addHook('onResponse', (_request, _reply, next) => next());
        scope.get('/beta', async () => ({ ready: true }));
        done();
      });
      await new Promise(resolve => setTimeout(resolve, 350));
    }`,
  });
  const app = Fastify({ pluginTimeout: 600 });
  t.after(() => app.close());
  app.register(
    (scope, _options, done) => {
      scope.register(businessModulesPlugin, { directory, capabilityLimits: {} });
      done();
    },
    { prefix: '/api' }
  );
  await app.ready();
  for (const path of ['/api/alpha', '/api/beta']) {
    const response = await app.inject(path);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ready: true });
  }
});

test('an explicitly configured Host timeout still rejects a stuck business plugin', async (t) => {
  const directory = await fixture(t, {
    'index.js': 'throw new Error("root entry must not run");',
    'stuck/index.js': 'export default async function stuck() { await new Promise(() => {}); }',
  });
  const app = Fastify({ pluginTimeout: 200 });
  t.after(() => app.close());
  app.register(businessModulesPlugin, { directory, capabilityLimits: {} });
  await assert.rejects(app.ready(), (error) => {
    assert.equal(error.code, 'FST_ERR_PLUGIN_TIMEOUT');
    assert.match(error.message, /stuck/);
    return true;
  });
});

test(
  'Server startup waits beyond the Fastify default deadline before accepting requests',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'octopus-cold-start-'));
    const config = loadServerConfig({
      SERVER_DATA_DIR: directory,
      DR_OCTOPUS_CODING_AGENT_DIR: join(directory, 'agent'),
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SERVER_FILE_LOG_ENABLED: 'false',
    });
    const app = createServer({
      config,
      databasePath: ':memory:',
      runtime: { onEvent: () => () => {}, onControlChanged: () => () => {}, close: async () => {} },
    });
    t.after(async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    });
    let initialized = false;
    app.register(async function coldResource(scope) {
      await new Promise((resolve) => setTimeout(resolve, 10100));
      assert.equal(app.server.listening, false);
      initialized = true;
      scope.get('/cold-resource', async () => ({ ready: initialized }));
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    assert.equal(initialized, true);
    const response = await app.inject('/cold-resource');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ready: true });
  }
);
