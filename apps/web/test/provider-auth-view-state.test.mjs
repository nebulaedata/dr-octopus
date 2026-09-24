/**
 * @author Codex
 * @description Verifies authenticated Provider forms remain truthful and allow credential replacement or method changes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitProviderAuth,
  isProviderAuthMethodActive,
} from '../src/features/settings/utils/provider-auth-view-state.ts';

const methods = ['api_key', 'oauth'];

test('Provider authentication state distinguishes the active method from the editable selection', () => {
  const oauthAuth = { configured: true, methods, activeMethod: 'oauth', source: 'stored' };
  const apiKeyAuth = { configured: true, methods, activeMethod: 'api_key', source: 'stored' };

  assert.equal(isProviderAuthMethodActive(oauthAuth, 'oauth'), true);
  assert.equal(isProviderAuthMethodActive(oauthAuth, 'api_key'), false);
  assert.equal(isProviderAuthMethodActive(apiKeyAuth, 'oauth'), false);
});

test('Provider authentication permits method changes and write-only API Key replacement', () => {
  const oauthAuth = { configured: true, methods, activeMethod: 'oauth', source: 'stored' };
  const apiKeyAuth = { configured: true, methods, activeMethod: 'api_key', source: 'stored' };

  assert.equal(canSubmitProviderAuth(oauthAuth, 'oauth'), false);
  assert.equal(canSubmitProviderAuth(oauthAuth, 'api_key'), true);
  assert.equal(canSubmitProviderAuth(apiKeyAuth, 'oauth'), true);
  assert.equal(canSubmitProviderAuth(apiKeyAuth, 'api_key'), true);
  assert.equal(canSubmitProviderAuth(apiKeyAuth, null), false);
});
