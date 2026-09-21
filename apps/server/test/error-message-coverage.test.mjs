/**
 * @author Codex
 * @description Audits every coded throw in Server and agent-core sources: a Chinese message must render CJK-free English through the registered catalogs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderErrorMessage } from '../dist/lib/i18n/error-catalog.js';
import { registerKnowledgeErrorMessages } from '../dist/modules/knowledge/knowledge.i18n.js';
import { registerMemoryErrorMessages } from '../dist/modules/memory/memory.i18n.js';
import { registerSessionErrorMessages } from '../dist/modules/sessions/sessions.i18n.js';
import { registerSettingsErrorMessages } from '../dist/modules/settings/settings.i18n.js';
import { registerAttachmentErrorMessages } from '../dist/modules/attachments/attachments.i18n.js';
import { collectThrownPairs } from './error-message-sources.mjs';

registerKnowledgeErrorMessages();
registerMemoryErrorMessages();
registerSessionErrorMessages();
registerSettingsErrorMessages();
registerAttachmentErrorMessages();

const CJK = /[一-鿿]/;

test('no coded throw leaks Chinese into the English projection', () => {
  const leaks = [];
  for (const { code, message } of collectThrownPairs()) {
    if (!CJK.test(message)) continue;
    const rendered = renderErrorMessage(code, undefined, 'en', message);
    if (CJK.test(rendered)) {
      leaks.push(`${code}: ${message}`);
    }
  }
  assert.deepEqual(leaks, [], 'coded throws whose English projection still contains Chinese');
});
