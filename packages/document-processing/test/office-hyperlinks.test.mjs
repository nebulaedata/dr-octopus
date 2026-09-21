/**
 * @author Codex
 * @description Regresses plain-text Office hyperlink extraction while retaining external-resource rejection.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseDocument, parseDocumentFile } from '../dist/index.js';

const relationshipNamespaces = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
];

/**
 * Build a Word hyperlink with visible runs and independently configurable relationship metadata.
 */
function linkedDocument(type, target = 'https://example.invalid/reference', extra = {}) {
  const entries = {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <w:body><w:p><w:r><w:t>参见</w:t></w:r><w:hyperlink r:id="link1">
      <w:r><w:t>服务</w:t></w:r><w:r><w:t>要求</w:t></w:r></w:hyperlink>
      <w:r><w:t>，并按约定执行。</w:t></w:r></w:p></w:body></w:document>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="link1" Type="${type}" Target="${target}" TargetMode="&#69;xternal"/>
      </Relationships>`,
    ...extra,
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])), {
    level: 0,
  });
}

/**
 * Own the test fixture so rejected files and successful parses both clean up their temporary data.
 */
async function sourceFile(t, bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-hyperlinks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'linked.docx');
  await writeFile(path, bytes);
  return path;
}

test('Office hyperlink relationships preserve display text without fetching targets in file and byte APIs', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Hyperlink targets must never be fetched');
  });
  for (const namespace of relationshipNamespaces) {
    for (const target of [
      'https://example.invalid/reference',
      'mailto:contact@example.invalid',
      'file:///missing.docx',
    ]) {
      const bytes = linkedDocument(`${namespace}/hyperlink`, target);
      const path = await sourceFile(t, bytes);
      const sections = [];
      for await (const section of parseDocumentFile(path, 'docx', { ocrMode: 'off' })) {
        sections.push(section);
      }
      assert.equal(sections.length, 1);
      assert.equal(sections[0].text, '参见服务要求，并按约定执行。');
      assert.deepEqual(sections[0].locator, { paragraph: 1 });
      assert.deepEqual(await parseDocument(bytes, 'docx', { ocrMode: 'off' }), sections);
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('external images, templates, objects and unknown relationships reject before yielding any text', async (t) => {
  for (const kind of [
    'image',
    'attachedTemplate',
    'oleObject',
    'package',
    'externalLink',
    'hyperlink-extra',
    '',
  ]) {
    const path = await sourceFile(t, linkedDocument(`${relationshipNamespaces[0]}/${kind}`));
    await assert.rejects(
      async () => {
        for await (const section of parseDocumentFile(path, 'docx', { ocrMode: 'off' })) {
          assert.fail(`Unexpected text: ${section.text}`);
        }
      },
      { code: 'OFFICE_CONTENT_REJECTED' }
    );
  }
});

test('a safe hyperlink cannot hide an external resource in another Office part', async (t) => {
  const bytes = linkedDocument(`${relationshipNamespaces[0]}/hyperlink`, undefined, {
    'word/_rels/header1.xml.rels': `<Relationships><Relationship TargetMode="External"
      Type="${relationshipNamespaces[0]}/image" Target="https://example.invalid/image.png"/></Relationships>`,
  });
  const path = await sourceFile(t, bytes);
  await assert.rejects(
    async () => {
      for await (const section of parseDocumentFile(path, 'docx', { ocrMode: 'off' })) {
        assert.fail(`Unexpected text: ${section.text}`);
      }
    },
    { code: 'OFFICE_CONTENT_REJECTED' }
  );
});
