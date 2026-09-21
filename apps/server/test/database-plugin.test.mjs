/**
 * @author Codex
 * @description Verifies Fastify owns one shared control-plane database and closes it exactly once.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase } from '../dist/db/client.js';
import { databasePlugin } from '../dist/plugins/database.plugin.js';

const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));

test('Database startup applies each versioned Drizzle migration exactly once', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-drizzle-migrations-'));
  const path = join(root, 'octopus.db');
  context.after(() => rm(root, { recursive: true, force: true }));

  for (let opening = 0; opening < 2; opening += 1) {
    const database = createDatabase(path);
    try {
      const migrationCount = database.sqlite
        .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
        .get().count;
      assert.equal(migrationCount, journal.entries.length);
      const attachmentSearchObjects = database.sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE name IN ('attachment_chunks_fts', 'attachment_chunks_ai', 'attachment_chunks_ad', 'attachment_chunks_au')`
        )
        .all();
      assert.equal(attachmentSearchObjects.length, 4);
    } finally {
      database.sqlite.close();
    }
  }
});

test('knowledge migration preserves historical Agent sessions, feedback and notifications', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-upgrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = join(root, 'migrations');
  await mkdir(join(legacy, 'meta'), { recursive: true });
  const entries = journal.entries.filter((entry) => entry.idx < 3);
  await writeFile(join(legacy, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    await copyFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), join(legacy, `${entry.tag}.sql`));
  const path = join(root, 'upgrade.db');
  const previous = new Database(path);
  migrate(drizzle(previous), { migrationsFolder: legacy });
  previous
    .prepare(
      `INSERT INTO sessions (id, workspace_id, agent_session_id, agent_session_path, title, created_at, updated_at)
    VALUES ('original', 'workspace', 'pi-original', '/original.jsonl', '原有会话', '2026-01-01', '2026-01-02')`
    )
    .run();
  previous
    .prepare(
      `INSERT INTO message_feedback VALUES ('feedback', 'original', 'entry', 'positive', '2026-01-02')`
    )
    .run();
  previous
    .prepare(
      `INSERT INTO session_notifications (event_key, workspace_id, session_id, title, summary, status, created_at)
    VALUES ('event', 'workspace', 'original', '完成', '原有通知', 'completed', '2026-01-02')`
    )
    .run();
  previous.close();
  const upgraded = createDatabase(path);
  try {
    assert.deepEqual(
      upgraded.sqlite.prepare('SELECT id, kind, agent_session_id, title FROM sessions').get(),
      { id: 'original', kind: 'agent', agent_session_id: 'pi-original', title: '原有会话' }
    );
    assert.equal(upgraded.sqlite.prepare('SELECT count(*) AS n FROM message_feedback').get().n, 1);
    assert.equal(upgraded.sqlite.prepare('SELECT count(*) AS n FROM session_notifications').get().n, 1);
    assert.throws(() => upgraded.sqlite.prepare("UPDATE sessions SET kind = 'invalid'").run(), /CHECK/);
    assert.equal(upgraded.sqlite.pragma('foreign_keys', { simple: true }), 1);
  } finally {
    upgraded.sqlite.close();
  }
});

test('Database plugin publishes one connection to descendant routes and owns shutdown', async () => {
  const logs = [];
  const server = Fastify({
    logger: {
      level: 'info',
      stream: {
        write(line) {
          logs.push(JSON.parse(line));
        },
      },
    },
  });
  server.register(databasePlugin, { path: ':memory:' });
  server.register(async (api) => {
    api.get('/database', async () => ({
      shared: api.database === server.database,
      probe: api.database.sqlite.prepare('SELECT 1 AS value').get().value,
    }));
  });

  const response = await server.inject({ method: 'GET', url: '/database' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { shared: true, probe: 1 });
  assert.equal(server.database.sqlite.open, true);

  const sqlite = server.database.sqlite;
  await server.close();
  assert.equal(sqlite.open, false);
  assert.deepEqual(
    logs.filter((entry) => entry.phase === 'database').map((entry) => entry.event),
    ['server.database.initializing', 'server.database.ready', 'server.database.closed']
  );
});

test('Database plugin rejects duplicate registration in one Fastify scope', async () => {
  const server = Fastify();
  server.register(databasePlugin, { path: ':memory:' });
  server.register(databasePlugin, { path: ':memory:' });

  await assert.rejects(
    server.ready(),
    /Database plugin must be registered exactly once per Fastify instance\./
  );
  await server.close();
});
