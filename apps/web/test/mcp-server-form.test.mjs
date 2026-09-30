/**
 * @author Codex
 * @description Verifies lossless MCP editor drafts and write-only credential serialization.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpFormDefaults, mcpFormInput } from '../src/features/settings/utils/mcp-server-form.ts';

/**
 * Creates a secret-free server fixture.
 */
function server(overrides = {}) {
  return {
    name: 'test',
    connection: { type: 'http', url: 'https://mcp.test', transport: 'sse' },
    enabled: true,
    directTools: false,
    includeTools: [],
    excludeTools: [],
    auth: { type: 'bearer', bearerTokenConfigured: true },
    secretBindings: [{ kind: 'header', name: 'X-Key' }],
    ...overrides,
  };
}

test('editor round-trips every direct tool mode and inherited/zero timeouts', () => {
  for (const directTools of [false, true, 'search', ['read_*']]) {
    const original = server({ directTools, idleTimeoutMinutes: 0, requestTimeoutMs: 0 });
    const saved = mcpFormInput(mcpFormDefaults(original), original);
    assert.deepEqual(saved.directTools, directTools);
    assert.equal(saved.idleTimeoutMinutes, 0);
    assert.equal(saved.requestTimeoutMs, 0);
    assert.equal(saved.connection.transport, 'sse');
  }
  assert.equal(mcpFormInput(mcpFormDefaults(server()), server()).requestTimeoutMs, undefined);
});

test('blank credential keeps existing value and explicit clear is serialized as null', () => {
  const original = server();
  const draft = mcpFormDefaults(original);
  assert.equal(draft.bearerToken, '');
  assert.equal(mcpFormInput(draft, original).auth.bearerToken, undefined);
  draft.clearBearer = true;
  assert.equal(mcpFormInput(draft, original).auth.bearerToken, null);
  draft.clearBearer = false;
  draft.bearerToken = 'replacement';
  assert.equal(mcpFormInput(draft, original).auth.bearerToken, 'replacement');
  draft.bearerSource = 'environment';
  draft.bearerTokenEnv = 'TOKEN';
  assert.equal(mcpFormInput(draft, original).auth.bearerToken, undefined);
});

test('changed targets cannot carry hidden binding values to a different endpoint', () => {
  const original = server();
  const draft = mcpFormDefaults(original);
  draft.target = 'https://different.test';
  assert.deepEqual(mcpFormInput(draft, original).headers, []);
  draft.headers.push({ name: 'New', value: 'explicit' });
  assert.deepEqual(mcpFormInput(draft, original).headers, [{ name: 'New', value: 'explicit' }]);
});

test('invalid numeric, keyword and authentication drafts are not submitted', () => {
  const original = server();
  for (const update of [
    { requestTimeoutMs: '-2' },
    { idleTimeoutMinutes: 'abc' },
    { searchKeywords: '{broken' },
    { searchKeywords: '{"read":"not-an-array"}' },
    { bearerSource: 'environment', bearerTokenEnv: 'invalid key' },
  ]) {
    assert.throws(() => mcpFormInput({ ...mcpFormDefaults(original), ...update }, original));
  }
});
