/**
 * @author Claude
 * @description Guards locale parity as a merge gate: the extracted en.json and the zh-CN overlay must cover identical key sets, and zh-CN ships fully translated so users never silently fall back to English.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const localesDir = new URL('../src/i18n/locales/', import.meta.url);

/**
 * Reads one generated locale file from disk.
 */
function readLocale(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, localesDir), 'utf8'));
}

/**
 * Flattens nested locale JSON into dot-joined key paths.
 */
function flattenKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return entry !== null && typeof entry === 'object' ? flattenKeys(entry, path) : [path];
  });
}

/**
 * Maps plural-suffixed keys back to their base key: languages legitimately ship
 * different plural forms (`count_one`/`count_other` in English, only `count_other` in Chinese),
 * so parity is checked on base keys, not exact forms.
 */
function baseKey(path) {
  return path.replace(/_(zero|one|two|few|many|other)$/, '');
}

test('en.json and zh-CN.json cover identical key sets', () => {
  const en = [...new Set(flattenKeys(readLocale('en')).map(baseKey))].sort();
  const zhCN = [...new Set(flattenKeys(readLocale('zh-CN')).map(baseKey))].sort();
  assert.deepEqual(zhCN, en, 'locale key sets drifted; run `pnpm i18n:extract` and commit the result');
});

test('zh-CN overlay ships fully translated', () => {
  const zhCN = readLocale('zh-CN');
  const untranslated = flattenKeys(zhCN).filter((path) => {
    const value = path.split('.').reduce((node, key) => node?.[key], zhCN);
    return typeof value !== 'string' || value.trim() === '';
  });
  assert.deepEqual(untranslated, [], 'zh-CN has untranslated keys; fill the values (see `pnpm i18n:status`)');
});
