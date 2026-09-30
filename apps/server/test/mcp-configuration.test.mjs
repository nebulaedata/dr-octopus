/**
 * @author Codex
 * @description Exercises MCP secret updates, endpoint isolation and complete editor configuration contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServerConfigurationInputSchema } from '@octopus/shared/protocol';
import { applyMcpConfiguration, projectMcpServerDetail } from '../dist/infrastructure/pi-mcp/projection.js';
import { registerMcpSettingsErrorMessages } from '../dist/modules/mcp-settings/mcp-settings.controller.js';
import { renderErrorMessage } from '../dist/infrastructure/i18n/error-catalog.js';

/**
 * Validates one complete HTTP input with optional overrides.
 */
function input(overrides = {}) {
  return McpServerConfigurationInputSchema.parse({
    connection: { type: 'http', url: 'http://127.0.0.1:8000/mcp', transport: 'streamable-http' },
    auth: { type: 'bearer' },
    ...overrides,
  });
}

/**
 * Projects an owned definition exactly as the store returns it to API consumers.
 */
function detail(entry) {
  return projectMcpServerDetail('local', entry, {
    globalServers: { local: entry },
    provenance: new Map(),
    sourcePaths: new Map(),
    conflicts: new Map(),
  });
}

test('Bearer secret supports create, preserve, replace, clear and source switching without leaking', () => {
  let entry = applyMcpConfiguration({}, input({ auth: { type: 'bearer', bearerToken: 'first-secret' } }));
  assert.equal(entry.bearerToken, 'first-secret');
  const projected = detail(entry);
  assert.equal(projected.auth.bearerTokenConfigured, true);
  assert.ok(!JSON.stringify(projected).includes('first-secret'));
  entry = applyMcpConfiguration(entry, input());
  assert.equal(entry.bearerToken, 'first-secret');
  entry = applyMcpConfiguration(entry, input({ auth: { type: 'bearer', bearerToken: 'next-secret' } }));
  assert.equal(entry.bearerToken, 'next-secret');
  const envEntry = applyMcpConfiguration(
    entry,
    input({ auth: { type: 'bearer', bearerTokenEnv: 'ACCESS_TOKEN' } })
  );
  assert.equal(envEntry.bearerToken, undefined);
  assert.equal(envEntry.bearerTokenEnv, 'ACCESS_TOKEN');
  const literalAgain = applyMcpConfiguration(
    envEntry,
    input({ auth: { type: 'bearer', bearerToken: 'new-secret' } })
  );
  assert.equal(literalAgain.bearerTokenEnv, undefined);
  assert.equal(literalAgain.bearerToken, 'new-secret');
  entry = applyMcpConfiguration(entry, input({ auth: { type: 'bearer', bearerToken: null } }));
  assert.equal(entry.bearerToken, undefined);
  assert.equal(detail(entry).auth.bearerTokenConfigured, false);
});

test('header lists preserve hidden values case-insensitively, replace and remove explicitly', () => {
  const existing = {
    url: 'http://127.0.0.1:8000/mcp',
    headers: { 'X-Key': 'header-secret', 'X-Remove': 'old' },
  };
  const saved = applyMcpConfiguration(
    existing,
    input({ auth: { type: 'none' }, headers: [{ name: 'x-key' }, { name: 'X-New', value: '' }] })
  );
  assert.deepEqual(saved.headers, { 'x-key': 'header-secret', 'X-New': '' });
  assert.ok(!JSON.stringify(detail(saved)).includes('header-secret'));
  assert.throws(
    () => applyMcpConfiguration(existing, input({ headers: [{ name: 'X-Unknown' }] })),
    /requires a value/
  );
  assert.deepEqual(applyMcpConfiguration(existing, input({ headers: [] })).headers, {});
});

test('endpoint changes drop old secrets, custom CA and signer while preserving unrelated fields', () => {
  const existing = {
    url: 'http://old.test/mcp',
    bearerToken: 'old-secret',
    bearerTokenStore: true,
    headers: { Authorization: 'old-secret' },
    caFile: 'private-ca.pem',
    requestHeadersCommand: { command: 'signer' },
    oauth: { clientId: 'old', clientSecret: 'old-oauth' },
    custom: { keep: true },
  };
  const saved = applyMcpConfiguration(existing, input());
  for (const key of [
    'bearerToken',
    'headers',
    'caFile',
    'requestHeadersCommand',
    'oauth',
    'bearerTokenStore',
  ])
    assert.equal(saved[key], undefined, key);
  assert.deepEqual(saved.custom, { keep: true });
  const changed = applyMcpConfiguration(
    existing,
    input({
      auth: { type: 'bearer', bearerToken: 'fresh-secret' },
      headers: [{ name: 'X-Key', value: 'fresh-header' }],
    })
  );
  assert.equal(changed.bearerToken, 'fresh-secret');
  assert.deepEqual(changed.headers, { 'X-Key': 'fresh-header' });
});

test('OAuth edits retain external metadata and allow explicit client secret removal', () => {
  const existing = {
    url: 'http://127.0.0.1:8000/mcp',
    oauth: {
      clientId: 'old',
      clientSecret: 'oauth-secret',
      scope: 'old',
      grantType: 'client_credentials',
      redirectUri: 'http://localhost/callback',
    },
  };
  const saved = applyMcpConfiguration(
    existing,
    input({ auth: { type: 'oauth', oauthClientId: 'new', oauthScope: 'read' } })
  );
  assert.equal(saved.oauth.clientSecret, 'oauth-secret');
  assert.equal(saved.oauth.grantType, 'client_credentials');
  assert.ok(detail(saved).externalFields.includes('oauth.redirectUri'));
  assert.ok(!JSON.stringify(detail(saved)).includes('oauth-secret'));
  const cleared = applyMcpConfiguration(saved, input({ auth: { type: 'oauth', oauthClientSecret: null } }));
  assert.equal(cleared.oauth.clientSecret, undefined);
  assert.equal(cleared.oauth.clientId, undefined);
  assert.equal(cleared.oauth.scope, undefined);
});

test('stdio environment is scoped to command and runtime/tool fields survive projection', () => {
  const values = input({
    connection: { type: 'stdio', command: 'node', args: ['server.mjs'], cwd: '/tmp' },
    auth: { type: 'none' },
    inheritEnv: false,
    environment: [{ name: 'TOKEN', value: 'env-secret' }],
    lifecycle: 'lazy-keep-alive',
    idleTimeoutMinutes: 0,
    requestTimeoutMs: 15000,
    protocolVersion: 'auto',
    directTools: ['read_*'],
    toolPrefix: 'mcp',
    debug: true,
    trace: true,
    searchKeywords: { read: ['files', 'search'] },
  });
  const saved = applyMcpConfiguration({}, values);
  const projected = detail(saved);
  assert.equal(projected.inheritEnv, false);
  assert.equal(projected.idleTimeoutMinutes, 0);
  assert.equal(projected.requestTimeoutMs, 15000);
  assert.deepEqual(projected.directTools, ['read_*']);
  assert.deepEqual(projected.searchKeywords, { read: ['files', 'search'] });
  assert.ok(!JSON.stringify(projected).includes('env-secret'));
  const changed = applyMcpConfiguration(
    saved,
    input({ connection: { type: 'stdio', command: 'other' }, auth: { type: 'none' } })
  );
  assert.equal(changed.env, undefined);
});

test('closed schema rejects incompatible authentication, duplicate headers and executable secrets', () => {
  for (const invalid of [
    { auth: { type: 'none', bearerToken: 'secret' } },
    { auth: { type: 'bearer', bearerToken: 'secret', bearerTokenEnv: 'TOKEN' } },
    { auth: { type: 'bearer', bearerToken: '!run-secret-helper' } },
    { auth: { type: 'bearer', bearerToken: 'a\r\nX-Extra: value' } },
    { auth: { type: 'oauth', oauthClientSecret: '!run-secret-helper' } },
    {
      headers: [
        { name: 'x-key', value: 'a' },
        { name: 'X-Key', value: 'b' },
      ],
    },
    { headers: [{ name: 'X-Key', value: 'a\r\nAuthorization: other' }] },
    { headers: [{ name: 'Authorization', value: 'other' }] },
    { environment: [] },
    { requestTimeoutMs: -1 },
    { idleTimeoutMinutes: 1.5 },
    { auth: { type: 'bearer' }, connection: { type: 'stdio', command: 'node' } },
    { arbitrary: true },
  ])
    assert.throws(() => input(invalid));
});

test('automatic authentication removes an explicit mode without losing same-endpoint credentials', () => {
  const existing = { url: 'http://127.0.0.1:8000/mcp', auth: false, bearerToken: 'secret' };
  const automatic = applyMcpConfiguration(existing, input({ auth: { type: 'auto' } }));
  assert.equal(automatic.auth, undefined);
  assert.equal(automatic.bearerToken, 'secret');
  assert.equal(detail(automatic).auth.type, 'auto');
  const disabled = applyMcpConfiguration(automatic, input({ auth: { type: 'none' } }));
  assert.equal(disabled.auth, false);
  assert.equal(disabled.bearerToken, undefined);
});

test('MCP binding errors provide bilingual generic messages without reflecting private input', () => {
  registerMcpSettingsErrorMessages();
  registerMcpSettingsErrorMessages();
  for (const code of ['MCP_BINDING_VALUE_REQUIRED', 'MCP_AUTH_HEADER_CONFLICT']) {
    const english = renderErrorMessage(code, undefined, 'en', 'private-input');
    const chinese = renderErrorMessage(code, undefined, 'zh-CN', 'private-input');
    assert.ok(english.length > 0);
    assert.ok(chinese.length > 0);
    assert.notEqual(english, 'private-input');
    assert.notEqual(chinese, 'private-input');
    assert.notEqual(english, chinese);
  }
});
