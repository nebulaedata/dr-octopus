/**
 * @author Codex
 * @description Guards the Settings Provider authentication UI and its write-only secret transport boundary.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Provider authentication stays inline and keeps API Keys out of mutation variables', () => {
  const details = readFileSync(
    new URL('../src/features/settings/model-providers/ProviderDetails.tsx', import.meta.url),
    'utf8'
  );
  const authForm = readFileSync(
    new URL('../src/features/settings/model-providers/ProviderAuthForm.tsx', import.meta.url),
    'utf8'
  );
  const prompt = readFileSync(
    new URL('../src/features/settings/model-providers/ProviderAuthPromptForm.tsx', import.meta.url),
    'utf8'
  );
  const reset = readFileSync(
    new URL('../src/features/settings/model-providers/ProviderAuthReset.tsx', import.meta.url),
    'utf8'
  );
  const api = readFileSync(new URL('../src/api/settings.ts', import.meta.url), 'utf8');
  const queries = readFileSync(new URL('../src/queries/provider-auth-queries.ts', import.meta.url), 'utf8');

  assert.match(details, /<ProviderAuthForm/u);
  assert.doesNotMatch(details, /ProviderAuthDialog/u);
  assert.match(authForm, /ProviderAuthMethodSelect/u);
  assert.match(authForm, /useProviderAuthSession/u);
  assert.match(authForm, /placeholder=\{apiKeyPlaceholder\(provider, t\)\}/u);
  assert.match(authForm, /value=\{field\.state\.value\}/u);
  assert.doesNotMatch(authForm, /value=\{provider[^}]*apiKey/u);
  assert.match(authForm, /answer: readApiKey\(\)/u);
  assert.match(queries, /refetchIntervalInBackground: false/u);
  assert.match(queries, /answerProviderAuthPrompt\(providerKey, authSessionId/u);
  assert.doesNotMatch(queries, /mutationFn:[^\n]*answerProviderAuthPrompt/u);
  assert.match(prompt, /submission\.submit\(prompt\.id, \(\) => value\.answer\)/u);
  assert.match(prompt, /finally \{[\s\S]*form\.reset\(\)/u);
  assert.match(authForm, /<ProviderAuthReset/u);
  assert.match(reset, /provider\.auth\.configured && provider\.auth\.source === 'stored'/u);
  assert.match(reset, /<Dialog/u);
  assert.match(reset, /settings\.providers\.auth\.reset/u);
  assert.match(api, /export function resetProviderAuth/u);
  assert.match(api, /method: 'DELETE'/u);
  assert.match(queries, /export function useResetProviderAuth/u);
  assert.match(queries, /invalidateQueries\(\{ queryKey: queryKeys\.modelProviders \}\)/u);
});
