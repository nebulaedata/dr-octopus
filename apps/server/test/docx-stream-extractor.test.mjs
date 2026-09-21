/**
 * @author root
 * @description Verifies bounded streaming DOCX text extraction and Office container security contracts.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { extractDocxText } from '../dist/modules/attachments/workers/docx-stream-extractor.js';

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

/**
 * Writes a deterministic minimal DOCX archive for one test case.
 *
 * @param root Temporary test directory.
 * @param documentXml WordprocessingML main document content.
 * @param extraEntries Optional additional ZIP entries.
 */
async function writeDocx(root, documentXml, extraEntries = {}) {
  const entries = {
    '[Content_Types].xml': strToU8(contentTypes),
    'word/document.xml': strToU8(documentXml),
    ...Object.fromEntries(Object.entries(extraEntries).map(([name, value]) => [name, strToU8(value)])),
  };
  const path = join(root, 'fixture.docx');
  await writeFile(path, Buffer.from(zipSync(entries, { level: 6 })));
  return path;
}

test('streams visible DOCX paragraphs and table rows without field or deleted text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-docx-stream-'));
  try {
    const path = await writeDocx(
      root,
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:ins><w:r><w:t>world</w:t></w:r></w:ins><w:del><w:r><w:delText>removed</w:delText><w:t>hidden</w:t></w:r></w:del></w:p>
          <w:p><w:r><w:instrText>PAGE</w:instrText><w:t>Visible</w:t><w:tab/><w:t>text</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        </w:body>
      </w:document>`,
      {
        'word/header1.xml': '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        'word/media/image1.png': 'not-decoded',
      }
    );

    const document = await extractDocxText(path, 10_000);

    assert.deepEqual(
      document.units.map(({ type, text }) => ({ type, text })),
      [
        { type: 'paragraph', text: 'Hello world' },
        { type: 'paragraph', text: 'Visible\ttext' },
        { type: 'table', text: 'A1\tB1' },
      ]
    );
    assert.equal(document.truncated, false);
    assert.deepEqual(document.diagnostics, ['DOCX_IMAGES_OMITTED']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('marks DOCX output as truncated at the configured character limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-docx-limit-'));
  try {
    const path = await writeDocx(
      root,
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>abcdefghij</w:t></w:r></w:p></w:body></w:document>`
    );
    const document = await extractDocxText(path, 5);

    assert.equal(document.units[0]?.text, 'abcde');
    assert.equal(document.truncated, true);
    assert.deepEqual(document.diagnostics, ['DOCX_TEXT_TRUNCATED']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects DOCX external relationships and active payload entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-docx-security-'));
  try {
    const documentXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;
    const externalPath = await writeDocx(root, documentXml, {
      'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="https://example.test" TargetMode="External" Type="test"/></Relationships>`,
    });
    await assert.rejects(extractDocxText(externalPath, 1_000), {
      code: 'PROCESSOR_CONTENT_REJECTED',
    });

    const macroPath = await writeDocx(root, documentXml, {
      'word/vbaProject.bin': 'payload',
    });
    await assert.rejects(extractDocxText(macroPath, 1_000), {
      code: 'PROCESSOR_CONTENT_REJECTED',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects malformed WordprocessingML after streaming the full entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-docx-malformed-'));
  try {
    const path = await writeDocx(
      root,
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>broken</w:t></w:r></w:body></w:document>`
    );

    await assert.rejects(extractDocxText(path, 1_000));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
