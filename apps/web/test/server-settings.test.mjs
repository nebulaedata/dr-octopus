/**
 * @author Codex
 * @description Verifies inheritance-preserving Server drafts and strict browser Origin input.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOrigins,
  serverChanges,
  validateServerField,
} from '../src/features/settings/server/server-fields.ts';

/** Passes default English copy through, matching the production fallback contract. */
const t = (key, defaultValue) => defaultValue;

test('Server drafts distinguish inheritance, empty strings and explicit default values', () => {
  assert.deepEqual(serverChanges({ SERVER_PORT: null }, { SERVER_PORT: '03000' }), { SERVER_PORT: '3000' });
  assert.deepEqual(serverChanges({ SERVER_PORT: null }, { SERVER_PORT: '3000' }), { SERVER_PORT: '3000' });
  assert.deepEqual(serverChanges({ SERVER_PORT: '3000' }, { SERVER_PORT: null }), { SERVER_PORT: null });
  assert.deepEqual(serverChanges({ SERVER_CORS_ORIGIN: null }, { SERVER_CORS_ORIGIN: '' }), {
    SERVER_CORS_ORIGIN: '',
  });
});
test('Origins normalize default ports and reject privilege-broadening URL input', () => {
  assert.equal(normalizeOrigins(['https://example.com:443/', 'https://example.com']), 'https://example.com');
  for (const value of [
    'https://example.com/path',
    'https://u:p@example.com',
    'file:///tmp',
    'https://example.com?q=1',
    'https://*.example.com',
  ])
    assert.throws(() => normalizeOrigins([value]));
  assert.equal(normalizeOrigins([]), '');
  assert.ok(validateServerField(t, 'SERVER_PORT', '65536'));
  assert.ok(validateServerField(t, 'SERVER_MAX_ACTIVE_RUNTIMES', '1.5'));
  assert.equal(validateServerField(t, 'SERVER_PORT', null), undefined);
});
