/**
 * @author Codex
 * @description Verifies translated retry outcomes, plurals and bounded countdowns.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { readFileSync } from 'node:fs';
import { formatRetryTitle } from '../src/features/session/utils/retry-presentation.ts';

test('retry statuses use translated counts in Chinese and singular/plural English', async () => {
  const zh = JSON.parse(readFileSync(new URL('../src/i18n/locales/zh-CN.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8'));
  const i18n = createInstance();
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zh }, en: { translation: en } } });
  const t = (key, defaultValue, options) => i18n.t(key, { defaultValue, ...options });
  const retry = { status: 'succeeded', attempt: 1, scheduledAt: 1000, delayMs: 5000 };
  assert.equal(formatRetryTitle(retry, 1000, t), '重试 1 次后已恢复');
  assert.equal(formatRetryTitle({ ...retry, status: 'failed', attempt: 2 }, 1000, t), '重试 2 次后仍失败');
  assert.equal(
    formatRetryTitle({ ...retry, status: 'waiting', maxAttempts: 3 }, 2000, t),
    '4 秒后开始第 1 次重试，共 3 次…'
  );
  assert.ok(formatRetryTitle({ ...retry, status: 'waiting' }, 10000, t).startsWith('0 秒'));
  await i18n.changeLanguage('en');
  assert.equal(formatRetryTitle(retry, 1000, t), 'Recovered after 1 retry');
  assert.equal(formatRetryTitle({ ...retry, attempt: 2 }, 1000, t), 'Recovered after 2 retries');
});
