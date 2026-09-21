/**
 * @author Codex
 * @description Verifies persisted Session pin ordering, unpinning, and the per-Workspace limit.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../dist/db/client.js';
import { SessionsRepository } from '../dist/modules/sessions/sessions.repository.js';

/**
 * Inserts a deterministic Session row into the test catalog.
 *
 * @param {SessionsRepository} repository Session catalog under test.
 * @param {string} id Stable Session identifier.
 * @param {string} workspaceId Owning Workspace identifier.
 * @param {number} offset Creation-time offset used to verify ordering.
 */
function insertSession(repository, id, workspaceId, offset) {
  const timestamp = new Date(offset).toISOString();
  repository.upsert({
    id,
    workspaceId,
    agentSessionId: `agent-${id}`,
    agentSessionPath: `C:\\sessions\\${id}.jsonl`,
    title: id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

test('Session pins persist above unpinned rows and enforce a three-item Workspace limit', () => {
  const database = createDatabase(':memory:');
  try {
    const repository = new SessionsRepository(database);
    insertSession(repository, 'session-a', 'workspace-a', 1);
    insertSession(repository, 'session-b', 'workspace-a', 2);
    insertSession(repository, 'session-c', 'workspace-a', 3);
    insertSession(repository, 'session-d', 'workspace-a', 4);
    insertSession(repository, 'session-other', 'workspace-b', 5);

    assert.ok(repository.setPinned('session-a', true).pinnedAt);
    assert.ok(repository.setPinned('session-b', true).pinnedAt);
    assert.ok(repository.setPinned('session-c', true).pinnedAt);
    assert.throws(() => repository.setPinned('session-d', true), /SESSION_PIN_LIMIT/);
    assert.ok(repository.setPinned('session-other', true).pinnedAt);

    const ordered = repository.list({ workspaceId: 'workspace-a' });
    assert.deepEqual(
      ordered
        .slice(0, 3)
        .map((session) => session.id)
        .toSorted(),
      ['session-a', 'session-b', 'session-c']
    );
    assert.equal(ordered[3]?.id, 'session-d');

    const unpinned = repository.setPinned('session-b', false);
    assert.equal(unpinned.pinnedAt, undefined);
    assert.ok(repository.setPinned('session-d', true).pinnedAt);
  } finally {
    database.sqlite.close();
  }
});
