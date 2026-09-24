/**
 * @author Claude
 * @description Guards that every catalog command has a statically extractable label with en/zh-CN locale coverage.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SHORTCUT_COMMAND_IDS } from '../src/lib/shortcuts/shortcut-catalog.ts';

test('every shortcut command label is statically extractable and translated', () => {
  const hook = readFileSync(
    new URL('../src/features/settings/hooks/use-shortcut-command-labels.ts', import.meta.url),
    'utf8'
  );
  const en = JSON.parse(readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8'));
  const zhCN = JSON.parse(readFileSync(new URL('../src/i18n/locales/zh-CN.json', import.meta.url), 'utf8'));

  for (const id of SHORTCUT_COMMAND_IDS) {
    assert.ok(hook.includes(`'${id}':`), `use-shortcut-command-labels must map catalog command ${id}`);
  }

  const literalKeys = [...hook.matchAll(/t\('(?<key>settings\.shortcuts\.commands\.[^']+)'/gu)].map(
    (match) => match.groups.key
  );
  assert.equal(
    literalKeys.length,
    SHORTCUT_COMMAND_IDS.length,
    'use-shortcut-command-labels must hold one literal t() label per catalog command'
  );

  for (const key of literalKeys) {
    const name = key.slice('settings.shortcuts.commands.'.length);
    assert.ok(en.settings?.shortcuts?.commands?.[name], `en.json missing ${key}; run pnpm i18n:extract`);
    assert.ok(zhCN.settings?.shortcuts?.commands?.[name], `zh-CN.json missing translation for ${key}`);
  }
});
