/**
 * @author Codex
 * @description Verifies authoritative Pi Session persistence reads, metadata guards, and offline derivation.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiSessionRepository } from '../dist/lib/runtime/index.js';

test('Pi Session repository reads history and derives a dormant fork without mutating the source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-pi-session-repository-'));
  const workspace = join(root, 'workspace');
  const sessionDir = join(root, 'sessions');
  await Promise.all([mkdir(workspace), mkdir(sessionDir)]);
  try {
    const manager = SessionManager.create(workspace, sessionDir);
    const entryId = manager.appendMessage({ role: 'user', content: 'Continue here', timestamp: Date.now() });
    const sourcePath = manager.getSessionFile();
    assert.ok(sourcePath);
    await writeFile(
      sourcePath,
      `${[manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      'utf8'
    );

    const repository = new PiSessionRepository();
    const metadata = await repository.readMetadata(sourcePath);
    const before = repository.getEntries(sourcePath);
    const derived = await repository.derive(sourcePath, 'fork', entryId);

    assert.equal(metadata.sessionId, manager.getSessionId());
    assert.equal(metadata.cwd, workspace);
    assert.equal(before.entries.length, 1);
    assert.equal(derived.prefill, 'Continue here');
    assert.notEqual(derived.sessionId, metadata.sessionId);
    assert.equal(repository.getEntries(sourcePath).entries.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Pi Session repository translates malformed headers into a stable Session failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-pi-session-invalid-'));
  const sessionPath = join(root, 'invalid.jsonl');
  try {
    await writeFile(sessionPath, '{"type":"message"}\n', 'utf8');
    const repository = new PiSessionRepository();
    await assert.rejects(
      repository.readMetadata(sessionPath),
      (error) => error.code === 'SESSION_METADATA_INVALID'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
