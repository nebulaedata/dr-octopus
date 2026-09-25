/**
 * @author Codex
 * @description Supplements behavior tests with the pre-refactor route, SQL, and schema contracts.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sourceContracts } from './source-contracts.mjs';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const baseline = JSON.parse(
  readFileSync(new URL('./fixtures/server-refactor-contracts.json', import.meta.url), 'utf8')
);

/**
 * Collects source inputs without importing plugins or starting background work.
 */
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return path.endsWith('.ts') ? [{ path, text: readFileSync(path, 'utf8') }] : [];
  });
}

test('module relocation preserves the existing route declarations and SQL statements', () => {
  const current = sourceContracts(sources(sourceRoot));
  for (const route of baseline.contracts.routes) {
    assert.ok(current.routes.includes(route), `Original route removed: ${route}`);
  }
  assert.deepEqual(current.sql, baseline.contracts.sql);
});

test('the refactor leaves the database schema unchanged', () => {
  const schema = readFileSync(join(sourceRoot, 'db/schema.ts'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(schema).digest('hex'), baseline.schema);
});
