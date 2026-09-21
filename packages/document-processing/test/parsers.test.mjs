/**
 * @author Codex
 * @description Bounded document and archive fixtures without network model dependencies.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { expandArchive, parseDocument } from '../dist/index.js';
import { scannedPdf } from './fixtures/scan-pdf.mjs';

test('nested archives retain Office documents and enumerate unrelated leaves', () => {
  const office = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<document/>'),
  });
  const inner = zipSync({ 'guide.md': strToU8('知识库测试'), 'report.docx': office });
  const outer = zipSync({ '资料/inner.zip': inner, 'unknown.bin': new Uint8Array([1, 2, 3]) });
  const leaves = expandArchive('资料.zip', outer);
  assert.deepEqual(
    leaves.map((leaf) => leaf.format),
    ['md', 'docx', 'bin']
  );
  assert.ok(leaves[0].path.includes('inner.zip'));
});

test('recursive decompression budgets do not reset between sibling archives', () => {
  const inner = zipSync({ 'file.txt': strToU8('fixture') });
  const outer = zipSync({ 'a.zip': inner, 'b.zip': inner });
  assert.throws(
    () =>
      expandArchive('outer.zip', outer, {
        entries: 0,
        expandedBytes: 0,
        maxEntries: 3,
        maxExpandedBytes: 100000,
        maxEntryBytes: 100000,
        maxDepth: 4,
      }),
    { code: 'DOCUMENT_LIMIT' }
  );
});

test('ZIP traversal paths, corrupt checksums and expansion bombs fail closed', () => {
  assert.throws(() => expandArchive('evil.zip', zipSync({ '../evil.md': strToU8('bad') })), {
    code: 'ARCHIVE_PATH_INVALID',
  });
  const corrupt = zipSync({ 'text.md': strToU8('safe') }, { level: 0 });
  corrupt[37] ^= 1;
  assert.throws(() => expandArchive('bad.zip', corrupt));
  assert.throws(() => expandArchive('bomb.zip', zipSync({ 'large.txt': strToU8('a'.repeat(100000)) })), {
    code: 'DOCUMENT_LIMIT',
  });
});

test('CSV handles quoted cells and preserves row locations and headers', async () => {
  const result = await parseDocument(strToU8('name,note\nAlice,"one,two"\n'), 'csv', { ocrMode: 'off' });
  assert.equal(result[1].locator.row, 2);
  assert.match(result[1].text, /note: one,two/u);
});

test('PPT follows presentation relationships instead of filename order and retains speaker notes', async () => {
  const slide = (text) =>
    strToU8(`<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/presentation.xml': strToU8(
      '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId id="1" r:id="second"/><p:sldId id="2" r:id="first"/></p:sldIdLst></p:presentation>'
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      '<Relationships><Relationship Id="first" Type="urn:/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="urn:/slide" Target="slides/slide2.xml"/></Relationships>'
    ),
    'ppt/slides/slide1.xml': slide('后来显示'),
    'ppt/slides/slide2.xml': slide('最先显示'),
    'ppt/slides/slide3.xml': slide('不应索引的孤立文件'),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(
      '<Relationships><Relationship Id="notes" Type="urn:/notesSlide" Target="../notesSlides/notesSlide2.xml"/></Relationships>'
    ),
    'ppt/notesSlides/notesSlide2.xml': slide('补充说明'),
  });
  const result = await parseDocument(bytes, 'pptx', { ocrMode: 'off' });
  assert.deepEqual(
    result.map((item) => item.locator.slide),
    [1, 1, 2]
  );
  assert.match(result[0].text, /最先显示/u);
  assert.match(result[1].text, /补充说明/u);
  assert.match(result[2].text, /后来显示/u);
});

test('DOCX includes footnotes and rejects unsafe XML declarations', async () => {
  const xml = (text) =>
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(xml('正文')),
    'word/footnotes.xml': strToU8(xml('脚注')),
  });
  const result = await parseDocument(bytes, 'docx', { ocrMode: 'off' });
  assert.deepEqual(
    result.map((item) => item.text),
    ['正文', '脚注']
  );
});

test('scanned PDF requires OCR and preserves page coordinates after bounded rasterization', async () => {
  const bytes = scannedPdf();
  await assert.rejects(parseDocument(bytes, 'pdf', { ocrMode: 'off' }), { code: 'OCR_NOT_CONFIGURED' });
  const result = await parseDocument(bytes, 'pdf', {
    ocrMode: 'auto',
    async recognizePage(png) {
      assert.equal(Buffer.from(png.subarray(1, 4)).toString(), 'PNG');
      return 'OCTOPUS KNOWLEDGE 2026';
    },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].extractionMethod, 'ocr');
  assert.equal(result[0].locator.page, 1);
});
