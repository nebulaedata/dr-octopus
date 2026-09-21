/**
 * @author Codex
 * @description Regresses legacy Word equation compatibility without executing embedded payloads or weakening Office validation.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseDocument, parseDocumentFile } from '../dist/index.js';

/**
 * Make an ordinary Word paragraph containing the Equation.3 object emitted by legacy Word documents.
 */
function equationDocument({ program = 'Equation.3', extra = {}, relationship = '' } = {}) {
  const entries = {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:office="urn:schemas-microsoft-com:office:office"
      xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <w:body><w:p><w:r><w:t>计算公式：</w:t></w:r><w:r><w:object>
      <office:OLEObject Type="Embed" ProgID="${program}" rel:id="eq1"/>
      </w:object></w:r><w:r><w:t>，以正文约定为准。</w:t></w:r></w:p></w:body></w:document>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="eq1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject"
      Target="embeddings/oleObject1.bin"/>${relationship}</Relationships>`,
    // Deliberately not a valid OLE program: compatibility must never depend on evaluating the payload.
    'word/embeddings/oleObject1.bin': 'opaque-equation-payload',
    ...extra,
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])), {
    level: 0,
  });
}

/**
 * Exercise the production file-stream API and dispose only this test's own temporary fixture.
 */
async function parseFixture(t, bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-equation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'equation.docx');
  await writeFile(path, bytes);
  const sections = [];
  for await (const section of parseDocumentFile(path, 'docx', { ocrMode: 'off' })) {
    sections.push(section);
  }
  return sections;
}

test('legacy Word equations preserve surrounding text and mark the unextracted formula in both APIs', async (t) => {
  const bytes = equationDocument();
  const sections = await parseFixture(t, bytes);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].text, '计算公式：[嵌入公式，未提取为文本]，以正文约定为准。');
  assert.deepEqual(sections[0].locator, { paragraph: 1 });
  assert.deepEqual(await parseDocument(bytes, 'docx', { ocrMode: 'off' }), sections);
});

test('unrelated binaries, macros, ActiveX and external relationships still reject', async (t) => {
  const cases = [
    { extra: { 'word/unrelated.bin': 'opaque' } },
    { extra: { 'word/vbaProject.bin': 'macro' } },
    { extra: { 'word/activeX/activeX1.xml': '<control/>' } },
    { relationship: '<Relationship Id="external" TargetMode="&#69;xternal" Target="https://example.test"/>' },
  ];
  for (const input of cases) {
    await assert.rejects(parseFixture(t, equationDocument(input)), { code: 'OFFICE_CONTENT_REJECTED' });
  }
});

test('ignored equation bytes are still covered by ZIP CRC integrity checks', async (t) => {
  const bytes = Buffer.from(equationDocument());
  const offset = bytes.indexOf('opaque-equation-payload');
  assert.ok(offset > 0);
  bytes[offset] ^= 1;
  await assert.rejects(parseFixture(t, bytes), { code: 'ARCHIVE_INVALID' });
});

test('Generic OLE packages preserve surrounding text without interpreting embedded payloads', async (t) => {
  const bytes = equationDocument({
    program: 'Package',
    extra: {
      'word/embeddings/other.bin': 'opaque',
      'word/embeddings/document.rels': 'not XML and must not be parsed',
      'word/embeddings/nested.zip': 'not a ZIP and must not be expanded',
    },
  });
  const sections = await parseFixture(t, bytes);
  assert.equal(sections[0].text, '计算公式：，以正文约定为准。');
  assert.ok(sections.every((section) => !section.text.includes('opaque')));
});

test('Embedded relationships must name an existing opaque package part', async (t) => {
  for (const target of ['embeddings/missing.bin', 'document.xml', '../../outside.bin']) {
    await assert.rejects(
      parseFixture(
        t,
        equationDocument({
          relationship: `<Relationship Id="bad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="${target}"/>`,
        })
      ),
      { code: 'OFFICE_CONTENT_REJECTED' }
    );
  }
});
