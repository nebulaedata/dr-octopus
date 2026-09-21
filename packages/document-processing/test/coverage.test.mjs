/**
 * @author Codex
 * @description Regresses actual Office extraction coverage, bounded diagnostics, and unified PDF findings.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { parseDocumentFile, assessDocumentCoverage } from '../dist/index.js';
import { DocumentCoverageV1Schema } from '@octopus/shared/protocol/attachments';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/**
 * Builds a deterministic Office source and collects the parser's coverage callback.
 */
async function parse(t, format, entries, stopEarly = false) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-coverage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, `fixture.${format}`);
  await writeFile(
    path,
    zipSync(
      Object.fromEntries(
        Object.entries({ '[Content_Types].xml': '<Types/>', ...entries }).map(([name, value]) => [
          name,
          Buffer.from(value),
        ])
      ),
      { mtime: new Date('2020-01-01T00:00:00Z') }
    )
  );
  let coverage;
  const sections = [];
  for await (const section of parseDocumentFile(path, format, {
    ocrMode: 'off',
    temporaryDirectory: directory,
    onCoverage: (value) => {
      coverage = value;
    },
  })) {
    sections.push(section);
    if (stopEarly) {
      break;
    }
  }
  if (Object.keys(entries).some((name) => name.includes('/embeddings/'))) {
    assert.ok(
      coverage.findings.some(
        (finding) => finding.code === 'EMBEDDED_CONTENT' && finding.status === 'not-processed'
      )
    );
    assert.ok(sections.every((section) => !section.text.includes('opaque')));
  }
  return { sections, coverage: DocumentCoverageV1Schema.parse(coverage) };
}

/**
 * Builds ordinary Word text with a real namespace independently of prefix naming.
 */
function word(text) {
  return `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
}

test('DOCX headers are extracted while images and comments remain explicitly uncovered', async (t) => {
  const { coverage, sections } = await parse(t, 'docx', {
    'word/document.xml': word('body'),
    'word/header1.xml': word('header'),
    'word/comments.xml': '<comments/>',
    'word/media/image.png': 'opaque image',
    'word/embeddings/file.pdf': 'opaque PDF',
  });
  assert.deepEqual(
    sections.map((section) => section.text),
    ['body', 'header']
  );
  assert.equal(coverage.textCoverage, 'partial');
  assert.ok(
    coverage.findings.some(
      (finding) =>
        finding.code === 'TEXT_REGION' &&
        finding.status === 'extracted' &&
        finding.locations.some((location) => location.part === 'word/header1.xml')
    )
  );
  assert.ok(
    coverage.findings.some(
      (finding) => finding.code === 'IMAGE_CONTENT' && finding.status === 'not-processed'
    )
  );
  assert.ok(
    coverage.findings.some(
      (finding) =>
        finding.status === 'not-processed' &&
        finding.locations.some((location) => location.part === 'word/comments.xml')
    )
  );
});

test('Early consumer return reports truncation instead of claiming unseen headers were extracted', async (t) => {
  const { coverage } = await parse(
    t,
    'docx',
    { 'word/document.xml': word('body'), 'word/header1.xml': word('header') },
    true
  );
  assert.equal(coverage.processing.text, 'truncated');
  assert.equal(coverage.assessmentStatus, 'partial');
  assert.ok(
    coverage.findings.some(
      (finding) =>
        finding.status === 'truncated' &&
        finding.locations.some((location) => location.part === 'word/header1.xml')
    )
  );
});

test('XLSX cached formula values remain unverified while a consumed hidden sheet is marked extracted', async (t) => {
  const { coverage } = await parse(t, 'xlsx', {
    'xl/workbook.xml': `<workbook xmlns="${S}" xmlns:r="urn:r"><sheets><sheet name="Hidden" state="hidden" r:id="s"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="s" Type="urn:/worksheet" Target="worksheets/custom.xml"/></Relationships>',
    'xl/worksheets/custom.xml': `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`,
    'xl/charts/chart1.xml': '<chart/>',
    'xl/embeddings/file.xlsx': 'opaque workbook',
  });
  assert.ok(
    coverage.findings.some((finding) => finding.code === 'FORMULA_VALUES' && finding.status === 'unknown')
  );
  assert.ok(
    coverage.findings.some((finding) => finding.code === 'HIDDEN_SHEET' && finding.status === 'extracted')
  );
  assert.ok(
    coverage.findings.some(
      (finding) => finding.code === 'CHART_CONTENT' && finding.status === 'not-processed'
    )
  );
});

test('PPTX notes actually read by the parser are distinguished from chart and layout gaps', async (t) => {
  const { coverage, sections } = await parse(t, 'pptx', {
    'ppt/presentation.xml': '<presentation xmlns:r="urn:r"><sldId r:id="s"/></presentation>',
    'ppt/_rels/presentation.xml.rels':
      '<Relationships><Relationship Id="s" Type="urn:/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': '<slide><p><t>slide</t></p></slide>',
    'ppt/slides/_rels/slide1.xml.rels':
      '<Relationships><Relationship Id="n" Type="urn:/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': '<notes><p><t>note</t></p></notes>',
    'ppt/charts/chart1.xml': '<chart/>',
    'ppt/embeddings/file.docx': 'opaque document',
  });
  assert.ok(sections.some((section) => section.text.includes('note')));
  assert.ok(
    coverage.findings.some(
      (finding) =>
        finding.status === 'extracted' &&
        finding.locations.some((location) => location.part.includes('notesSlide'))
    )
  );
  assert.ok(coverage.findings.some((finding) => finding.code === 'LAYOUT'));
});

test('Large inventories retain counts and declare omitted locations', async (t) => {
  const images = Object.fromEntries(
    Array.from({ length: 105 }, (_, index) => [`word/media/${index}.png`, 'image'])
  );
  const { coverage } = await parse(t, 'docx', { 'word/document.xml': word('body'), ...images });
  const finding = coverage.findings.find((value) => value.code === 'IMAGE_CONTENT');
  assert.equal(finding.count, 105);
  assert.equal(finding.locations.length, 100);
  assert.equal(finding.locationsOmitted, true);
  assert.ok(coverage.limits.includes('diagnostics'));
});

test('Unified PDF entry retains content evidence without recognition status', () => {
  const coverage = assessDocumentCoverage({
    format: 'pdf',
    pages: [{ page: 1, text: 'watermark', hasLargeImage: true }],
    pageCount: 1,
    truncated: false,
  });
  assert.equal('ocr' in coverage.processing, false);
  assert.equal(coverage.findings[0].code, 'SCAN_LIKELY');
  assert.deepEqual(DocumentCoverageV1Schema.parse(coverage), coverage);
});

test('An embedded XML payload cannot be consumed through a forged worksheet relationship', async (t) => {
  await assert.rejects(
    parse(t, 'xlsx', {
      'xl/workbook.xml': `<workbook xmlns="${S}" xmlns:r="urn:r"><sheets><sheet name="Payload" r:id="s"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="s" Type="urn:/worksheet" Target="embeddings/payload.xml"/></Relationships>',
      'xl/embeddings/payload.xml': `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>opaque</t></is></c></row></sheetData></worksheet>`,
    }),
    { code: 'OFFICE_CONTENT_REJECTED' }
  );
});
