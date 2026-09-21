/**
 * @author Codex
 * @description Regresses PDF CMap extraction and output isolation across processor attempts.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { ProcessorSupervisor } from '../dist/modules/attachments/workers/processor-supervisor.js';

const { PDFDocument, PDFName, PDFString } = createRequire(import.meta.url)('@cantoo/pdf-lib');
const limits = {
  wallTimeMs: 30_000,
  maxRssBytes: 1024 ** 3,
  maxOutputBytes: 1024 ** 2,
  maxOutputFiles: 30,
  maxImagePixels: 40_000_000,
  maxPages: 500,
  maxExtractedCharacters: 2_000_000,
};

test('Image-only PDFs beyond twenty pages produce text and coverage artifacts without automatic rendering', async (t) => {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2020-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  const jpeg = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: 'white' } })
    .jpeg()
    .toBuffer();
  const image = await pdf.embedJpg(jpeg);
  for (let index = 0; index < 25; index++) {
    pdf.addPage([600, 600]).drawImage(image, { x: 0, y: 0, width: 600, height: 600 });
  }
  const bytes = await pdf.save();
  const { root, supervisor, input } = await setup(t, bytes, 'application/pdf');
  const result = await supervisor.run(input);
  assert.deepEqual(result.manifest.outputs.map((output) => output.kind).sort(), [
    'chunks-jsonl',
    'document-json',
  ]);
  const document = JSON.parse(await readFile(join(root, result.outputKeys.get('document.json')), 'utf8'));
  assert.deepEqual(document.units, []);
  assert.equal(result.manifest.summary.pageCount, 25);
  assert.equal(document.coverage.textCoverage, 'partial');
  const scan = document.coverage.findings.find((finding) => finding.code === 'SCAN_LIKELY');
  assert.equal(scan.count, 25);
  assert.equal(scan.locations.at(-1).page, 25);
  assert.equal(document.truncated, false);
});

/**
 * Runs the real child in a disposable source/output root and returns verified output locations.
 */
async function setup(t, bytes, mime) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-pdf-processor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'input'), bytes);
  const supervisor = new ProcessorSupervisor(root);
  const input = {
    jobId: randomUUID(),
    attachmentId: randomUUID(),
    sourceKey: 'input',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    detectedMediaType: mime,
    limits,
  };
  return { root, supervisor, input };
}

test('Repeated attempts of the same job never overwrite or collide with prior artifacts', async (t) => {
  const { root, supervisor, input } = await setup(t, Buffer.from('retained text'), 'text/plain');
  await assert.rejects(supervisor.run({ ...input, limits: { ...limits, maxOutputBytes: 1 } }), {
    code: 'PROCESSOR_RESOURCE_LIMIT_EXCEEDED',
  });
  assert.deepEqual(await readdir(join(root, 'staging/jobs', input.jobId)), []);
  const first = await supervisor.run(input);
  const second = await supervisor.run(input);
  const firstKey = first.outputKeys.get('document.json');
  const secondKey = second.outputKeys.get('document.json');
  assert.notEqual(firstKey, secondKey);
  assert.equal(await readFile(join(root, firstKey), 'utf8'), await readFile(join(root, secondKey), 'utf8'));
});

test('PDF worker extracts Chinese text requiring a bundled CMap', async (t) => {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2020-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  const page = pdf.addPage([100, 100]);
  const descendant = pdf.context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType0',
    BaseFont: 'STSong-Light',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('GB1'), Supplement: 4 },
  });
  const font = pdf.context.register(
    pdf.context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'STSong-Light',
      Encoding: 'UniGB-UCS2-H',
      DescendantFonts: [descendant],
    })
  );
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font } }));
  page.node.set(
    PDFName.of('Contents'),
    pdf.context.register(pdf.context.stream(Buffer.from('BT /F1 12 Tf 10 50 Td <4E2D6587> Tj ET')))
  );
  const bytes = await pdf.save({ useObjectStreams: false });
  const { root, supervisor, input } = await setup(t, bytes, 'application/pdf');
  const result = await supervisor.run(input);
  const document = JSON.parse(await readFile(join(root, result.outputKeys.get('document.json')), 'utf8'));
  assert.equal(document.units[0].text, '中文');
  assert.deepEqual(result.manifest.outputs.map((output) => output.kind).sort(), [
    'chunks-jsonl',
    'document-json',
  ]);
});
