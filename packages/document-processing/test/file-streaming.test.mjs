/**
 * @author Codex
 * @description Exercises streamed Office fidelity, archive limits and cleanup, including a low-heap large-XML subprocess.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import ExcelJS from 'exceljs';
import { expandArchiveFile, parseDocumentFile } from '../dist/index.js';

/**
 * Own all fixture and parser scratch files under one disposable test directory.
 */
async function fixture(t, entries, format = 'docx') {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-stream-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, `source.${format}`);
  await writeFile(
    path,
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([name, text]) => [name, typeof text === 'string' ? strToU8(text) : text])
      ),
      { level: 0 }
    )
  );
  return { directory, path };
}

/**
 * Collect small expected outputs only; production consumers iterate with backpressure.
 */
async function collect(iterator) {
  const values = [];
  for await (const value of iterator) {
    values.push(value);
  }
  return values;
}

const word = (body) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const paragraph = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('DOCX streams cross-chunk Chinese text, table rows and footnotes', async (t) => {
  const { path } = await fixture(t, {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': word(
      paragraph('中文🙂'.repeat(6000)) +
        '<w:tbl><w:tr><w:tc>' +
        paragraph('甲') +
        '</w:tc><w:tc>' +
        paragraph('乙') +
        '</w:tc></w:tr></w:tbl>'
    ),
    'word/footnotes.xml': word(paragraph('脚注')),
  });
  const result = await collect(parseDocumentFile(path, 'docx', { ocrMode: 'off' }));
  assert.equal(result[0].text, '中文🙂'.repeat(6000));
  assert.equal(result[1].text, '甲\t乙');
  assert.equal(result[1].type, 'table');
  assert.equal(result[2].text, '脚注');
});

test('XLSX resolves disk-backed rich shared strings, sparse coordinates and formula caches', async (t) => {
  const { directory, path } = await fixture(
    t,
    {
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml':
        '<workbook xmlns:r="urn:r"><sheets><sheet name="数据" sheetId="1" r:id="s"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="s" Type="urn:/worksheet" Target="worksheets/custom.xml"/><Relationship Id="strings" Type="urn:/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>标题</t></si><si><r><t>你好</t></r><r><t>世界</t></r></si></sst>',
      'xl/worksheets/custom.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3"><f>1+1</f><v>2</v></c><c r="D3" t="inlineStr"><is><t>内联</t></is></c></row></sheetData></worksheet>',
    },
    'xlsx'
  );
  const result = await collect(
    parseDocumentFile(path, 'xlsx', { ocrMode: 'off', temporaryDirectory: directory })
  );
  assert.equal(result[1].text, '标题: 你好世界\tC: 2\tD: 内联');
  assert.deepEqual(result[1].locator, { sheet: '数据', row: 3 });
  for await (const section of parseDocumentFile(path, 'xlsx', {
    ocrMode: 'off',
    temporaryDirectory: directory,
  })) {
    assert.ok(section.text);
    break;
  }
  assert.deepEqual(await readdir(directory), ['source.xlsx']);
});

test('archives retain nested paths and release each leaf before advancing or returning', async (t) => {
  const nested = zipSync({ 'notes.txt': strToU8('nested') }, { level: 0 });
  const { path, directory } = await fixture(
    t,
    { 'inner.zip': nested, 'unsupported.bin': new Uint8Array([1]) },
    'zip'
  );
  const seen = [];
  for await (const leaf of expandArchiveFile('资料.zip', path, { temporaryDirectory: directory })) {
    seen.push([leaf.path, leaf.format, (await readFile(leaf.localPath)).length]);
  }
  assert.deepEqual(
    seen.map((value) => value.slice(0, 2)),
    [
      ['资料.zip/1-inner.zip/1-notes.txt', 'txt'],
      ['资料.zip/2-unsupported.bin', 'bin'],
    ]
  );
  for await (const leaf of expandArchiveFile('资料.zip', path, { temporaryDirectory: directory })) {
    assert.ok(leaf.localPath);
    break;
  }
  assert.deepEqual(await readdir(directory), ['source.zip']);
});

test('file archive traversal preserves GZIP and TAR member paths with shared budgets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-tar-stream-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = Buffer.from('tar content');
  const header = Buffer.alloc(512);
  header.write('notes.txt');
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
  header.fill(32, 148, 156);
  header[156] = 48;
  const checksum = [...header].reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  const tar = Buffer.concat([header, content, Buffer.alloc(512 - content.length), Buffer.alloc(1024)]);
  for (const [name, bytes, expected] of [
    ['notes.txt.gz', gzipSync(content), 'notes.txt.gz/1-notes.txt'],
    ['bundle.tar', tar, 'bundle.tar/1-notes.txt'],
    ['bundle.tgz', gzipSync(tar), 'bundle.tgz/1-notes.txt'],
  ]) {
    const path = join(directory, name);
    await writeFile(path, bytes);
    const seen = [];
    for await (const leaf of expandArchiveFile(name, path, { temporaryDirectory: directory })) {
      seen.push(leaf.path);
      assert.equal((await readFile(leaf.localPath)).toString(), 'tar content');
    }
    assert.deepEqual(seen, [expected]);
  }
  assert.equal((await readdir(directory)).length, 3);
});

test('archive traversal, CRC damage, sibling budgets and cancellation fail with no scratch leaks', async (t) => {
  const { path, directory } = await fixture(t, { '../escape.txt': 'bad' }, 'zip');
  await assert.rejects(collect(expandArchiveFile('bad.zip', path, { temporaryDirectory: directory })), {
    code: 'ARCHIVE_PATH_INVALID',
  });
  const corrupt = zipSync({ 'a.txt': strToU8('hello') }, { level: 0 });
  corrupt[35] ^= 1;
  await writeFile(path, corrupt);
  await assert.rejects(collect(expandArchiveFile('bad.zip', path, { temporaryDirectory: directory })), {
    code: 'ARCHIVE_INVALID',
  });
  await writeFile(path, zipSync({ 'a.txt': strToU8('one'), 'b.txt': strToU8('two') }, { level: 0 }));
  await assert.rejects(
    collect(
      expandArchiveFile('bad.zip', path, {
        temporaryDirectory: directory,
        budget: {
          entries: 0,
          expandedBytes: 0,
          maxEntries: 2,
          maxExpandedBytes: 5,
          maxEntryBytes: 10,
          maxDepth: 4,
        },
      })
    ),
    { code: 'DOCUMENT_LIMIT' }
  );
  const controller = new AbortController();
  await assert.rejects(
    async () => {
      for await (const leaf of expandArchiveFile('cancel.zip', path, {
        temporaryDirectory: directory,
        signal: controller.signal,
      })) {
        assert.ok(leaf);
        controller.abort();
      }
    },
    { name: 'AbortError' }
  );
  assert.deepEqual(await readdir(directory), ['source.zip']);
});

test('Office rejects external relationships even after the first readable paragraph', async (t) => {
  const { path } = await fixture(t, {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': word(paragraph('safe')),
    'word/_rels/document.xml.rels':
      '<Relationships><Relationship TargetMode="&#69;xternal" Target="https://example.test"/></Relationships>',
  });
  await assert.rejects(
    async () => {
      for await (const section of parseDocumentFile(path, 'docx', { ocrMode: 'off' })) {
        assert.fail(section.text);
      }
    },
    { code: 'OFFICE_CONTENT_REJECTED' }
  );
});

test('XLSX produced by ExcelJS preserves booleans, rich text and both date epochs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-xlsx-real-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const date1904 of [false, true]) {
    const workbook = new ExcelJS.Workbook();
    workbook.properties.date1904 = date1904;
    const sheet = workbook.addWorksheet('记录');
    sheet.addRow(['日期', '状态', '备注']);
    sheet.addRow([
      new Date('2026-09-11T00:00:00Z'),
      true,
      { richText: [{ text: '你好' }, { text: '世界' }] },
    ]);
    const path = join(directory, `${date1904}.xlsx`);
    await workbook.xlsx.writeFile(path);
    const result = await collect(
      parseDocumentFile(path, 'xlsx', { ocrMode: 'off', temporaryDirectory: directory })
    );
    assert.equal(result[1].text, '日期: 2026-09-11T00:00:00.000Z\t状态: TRUE\t备注: 你好世界');
  }
});

test('XML comments containing angle brackets cannot bypass the in-flight token limit', async (t) => {
  const { path } = await fixture(t, {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': word('<!--' + '<>'.repeat(700_000) + '-->' + paragraph('text')),
  });
  await assert.rejects(collect(parseDocumentFile(path, 'docx', { ocrMode: 'off' })), {
    code: 'DOCUMENT_LIMIT',
  });
});

test(
  'large DOCX XML parses under a 64 MiB heap without constructing document.xml',
  { timeout: 120_000 },
  async (t) => {
    const body = Array.from(
      { length: 70_000 },
      (_, index) =>
        `<w:p><w:pPr><w:rPr><w:rFonts w:ascii="${'x'.repeat(500)}"/></w:rPr></w:pPr><w:r><w:t>row ${index}</w:t></w:r></w:p>`
    ).join('');
    const { path } = await fixture(t, { '[Content_Types].xml': '<Types/>', 'word/document.xml': word(body) });
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    const script = `import { parseDocumentFile } from ${JSON.stringify(moduleUrl)}; let count = 0; for await (const section of parseDocumentFile(process.argv[1], 'docx', { ocrMode: 'off' })) { if (!section.text.startsWith('row ')) throw Error('text'); count++; } if (count !== 70000) throw Error(String(count)); console.log(count);`;
    const result = await promisify(execFile)(
      process.execPath,
      ['--max-old-space-size=64', '--input-type=module', '-e', script, path],
      { timeout: 110_000 }
    );
    assert.match(result.stdout, /70000/u);
  }
);

test('large XLSX shared strings stay on disk under a 64 MiB heap', { timeout: 120_000 }, async (t) => {
  const shared =
    '<sst>' +
    Array.from({ length: 6000 }, (_, index) => `<si><t>item-${index}-${'x'.repeat(8000)}</t></si>`).join('') +
    '</sst>';
  const { directory, path } = await fixture(
    t,
    {
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml':
        '<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet" sheetId="1" r:id="s"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="s" Type="urn:/worksheet" Target="worksheets/data.xml"/><Relationship Id="strings" Type="urn:/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
      'xl/sharedStrings.xml': shared,
      'xl/worksheets/data.xml':
        '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>5999</v></c></row></sheetData></worksheet>',
    },
    'xlsx'
  );
  const script = `import { parseDocumentFile } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)}; let count = 0; for await (const section of parseDocumentFile(process.argv[1], 'xlsx', { ocrMode: 'off', temporaryDirectory: process.argv[2] })) { if (!section.text.startsWith('A: item-5999-')) throw Error('shared string'); count++; } if (count !== 1) throw Error(String(count)); console.log(count);`;
  const result = await promisify(execFile)(
    process.execPath,
    ['--max-old-space-size=64', '--input-type=module', '-e', script, path, directory],
    { timeout: 110_000 }
  );
  assert.match(result.stdout, /1/u);
  assert.deepEqual(await readdir(directory), ['source.xlsx']);
});
