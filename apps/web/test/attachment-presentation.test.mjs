/**
 * @author root
 * @description Verifies the Host-owned attachment preview contract and shared horizontal rail integration.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MessageAttachmentSchema } from '@octopus/shared/protocol/attachments';

test('accepts the explicit Markdown preview mode and rejects renderer guesses outside the wire contract', () => {
  const attachment = {
    id: '68d73084-366f-4be3-85e7-60aa20329832',
    name: 'notes.md',
    detectedMediaType: 'text/markdown',
    byteSize: 128,
    presentationKind: 'file',
    availability: 'available',
    previewKind: 'markdown',
    contentUrl: '/api/workspaces/general/attachments/68d73084-366f-4be3-85e7-60aa20329832/content',
    capabilities: { canPreview: true, canPlay: false, canDownload: true },
  };

  assert.equal(MessageAttachmentSchema.parse(attachment).previewKind, 'markdown');
  assert.equal(MessageAttachmentSchema.safeParse({ ...attachment, previewKind: 'pdf' }).success, false);
  assert.deepEqual(
    MessageAttachmentSchema.parse({
      ...attachment,
      name: 'fixture.ts',
      detectedMediaType: 'text/x-source-code',
      previewKind: 'code',
      previewLanguage: 'typescript',
    }).previewLanguage,
    'typescript'
  );
  assert.equal(
    MessageAttachmentSchema.parse({
      ...attachment,
      name: 'notes.txt',
      detectedMediaType: 'text/plain',
      previewKind: 'code',
      previewLanguage: 'plaintext',
    }).previewLanguage,
    'plaintext'
  );
  assert.equal(
    MessageAttachmentSchema.safeParse({
      ...attachment,
      previewKind: 'code',
      previewLanguage: 'extension-derived-guess',
    }).success,
    false
  );
});

test('File Explorer edit and Attachment preview share the read-only-capable Monaco wrapper', () => {
  const editor = readFileSync(new URL('../src/components/CodeEditor.tsx', import.meta.url), 'utf8');
  const explorer = readFileSync(
    new URL('../src/features/session/FileEditorDialog.tsx', import.meta.url),
    'utf8'
  );
  const attachment = readFileSync(
    new URL('../src/features/session/MessageFileAttachment.tsx', import.meta.url),
    'utf8'
  );

  assert.match(editor, /domReadOnly: readOnly/u);
  assert.match(editor, /readOnly,/u);
  assert.match(explorer, /<CodeEditor path=\{path\} value=\{content\} onChange=\{setContent\}/u);
  assert.match(attachment, /<CodeEditor readOnly language=\{attachment\.previewLanguage\}/u);
});

test('Composer and Conversation share the wheel-enabled horizontal area without leaking attachment layout', () => {
  const area = readFileSync(new URL('../src/components/HorizontalArea.tsx', import.meta.url), 'utf8');
  const composer = readFileSync(
    new URL('../src/features/session/ComposerAttachments.tsx', import.meta.url),
    'utf8'
  );
  const conversation = readFileSync(
    new URL('../src/features/session/MessageAttachmentGroup.tsx', import.meta.url),
    'utf8'
  );

  assert.match(area, /useEventListener\('wheel'/u);
  assert.match(area, /event\.preventDefault\(\)/u);
  assert.ok(area.indexOf('event.preventDefault()') < area.indexOf('const multiplier'));
  assert.match(area, /aria-label="Scroll left"/u);
  assert.match(area, /aria-label="Scroll right"/u);
  assert.doesNotMatch(area, /ScrollBar/u);
  assert.doesNotMatch(area, /Attachment/u);
  assert.match(composer, /<HorizontalArea/u);
  assert.match(composer, /data-\[slot=attachment\]:w-72/u);
  assert.match(conversation, /<HorizontalArea/u);
  assert.match(conversation, /data-\[slot=attachment\]:w-72/u);
});

test('completed upload fingerprints cannot revive a deleted attachment resource', () => {
  const attachmentsApi = readFileSync(new URL('../src/api/attachments.ts', import.meta.url), 'utf8');

  assert.match(attachmentsApi, /removeFingerprintOnSuccess: true/u);
  assert.match(attachmentsApi, /resource\.status === 'deleted'/u);
  assert.match(attachmentsApi, /beginUpload\(false\)/u);
});
