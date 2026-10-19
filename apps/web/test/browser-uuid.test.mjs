/**
 * @author Codex
 * @description Regresses provider creation without browser randomUUID and enforces portable Web UUID usage.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import axios from 'axios';
import { ESLint, Linter } from 'eslint';
import { validate, version } from 'uuid';

test('provider creation sends UUID v4 idempotency keys when randomUUID is unavailable', async (t) => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalAdapter = axios.defaults.adapter;
  const requests = [];
  t.after(() => {
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
    axios.defaults.adapter = originalAdapter;
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
  });
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    return { data: { providerKey: 'test-provider' }, status: 200, headers: {}, config };
  };
  const { createCustomProvider } = await import('../src/api/custom-providers.ts');
  const input = { name: 'Mr.Token', runtime: 'mr-token' };
  assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
  assert.deepEqual(await createCustomProvider(input), { providerKey: 'test-provider' });
  await createCustomProvider(input);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.baseURL, '/api');
    assert.equal(request.url, '/settings/local-providers');
    assert.equal(request.method, 'post');
    assert.deepEqual(JSON.parse(request.data), input);
    const key = request.headers.get('Idempotency-Key');
    assert.ok(validate(key));
    assert.equal(version(key), 4);
  }
  assert.notEqual(requests[0].headers.get('Idempotency-Key'), requests[1].headers.get('Idempotency-Key'));
});

test('Web lint rejects native randomUUID access and accepts uuid v4', async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile('src/api/custom-providers.ts');
  const linter = new Linter();
  const rules = { 'no-restricted-syntax': config.rules['no-restricted-syntax'] };
  for (const expression of [
    'crypto.randomUUID()',
    'window.crypto.randomUUID()',
    'globalThis.crypto.randomUUID()',
    "crypto['randomUUID']()",
    'crypto.randomUUID',
  ]) {
    const messages = linter.verify(`export const id = ${expression};`, { rules });
    assert.ok(
      messages.some((message) => message.ruleId === 'no-restricted-syntax'),
      expression
    );
  }
  const messages = linter.verify("import { v4 as uuidv4 } from 'uuid'; export const id = uuidv4();", {
    rules,
  });
  assert.deepEqual(messages, []);
});
