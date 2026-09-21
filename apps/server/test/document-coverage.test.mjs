/**
 * @author Codex
 * @description Verifies Office coverage survives the real worker artifact and manifest boundary.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { ProcessorSupervisor } from '../dist/modules/attachments/workers/processor-supervisor.js';
import {
  mergeDocumentCoverage,
  readDocumentCoverage,
} from '../dist/modules/attachments/attachment-coverage.js';
import { attachmentDeliveryPrompt } from '../dist/modules/attachments/agent-attachment-prompt.js';

test('Office artifacts, persistence and Agent prompts share one bounded coverage contract', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-office-coverage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = zipSync(
    {
      '[Content_Types].xml': Buffer.from('<Types/>'),
      'word/document.xml': Buffer.from(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>'
      ),
      'word/media/image.png': Buffer.from('opaque bytes'),
      'word/embeddings/object.bin': Buffer.from('opaque embedded object'),
    },
    { mtime: new Date('2020-01-01T00:00:00Z') }
  );
  await writeFile(join(root, 'source'), bytes);
  const id = randomUUID();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const result = await new ProcessorSupervisor(root).run({
    jobId: randomUUID(),
    attachmentId: id,
    sourceKey: 'source',
    sha256,
    detectedMediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    limits: {
      wallTimeMs: 30_000,
      maxRssBytes: 1024 ** 3,
      maxOutputBytes: 1024 ** 2,
      maxOutputFiles: 10,
      maxImagePixels: 40_000_000,
      maxPages: 500,
      maxExtractedCharacters: 100_000,
    },
  });
  const document = JSON.parse(await readFile(join(root, result.outputKeys.get('document.json')), 'utf8'));
  const coverage = result.manifest.summary.coverage;
  assert.deepEqual(document.coverage, coverage);
  assert.equal('ocr' in coverage.processing, false);
  assert.equal(coverage.textCoverage, 'partial');
  const stored = mergeDocumentCoverage('{"formatEvidence":{"magicMatched":true}}', coverage);
  assert.equal(JSON.parse(stored).formatEvidence.magicMatched, true);
  assert.deepEqual(readDocumentCoverage(stored), coverage);
  const prompt = attachmentDeliveryPrompt([
    {
      attachmentId: id,
      name: 'image.docx',
      sha256,
      byteSize: bytes.length,
      detectedMediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      delivery: 'content-derived',
      contentAvailableToModel: true,
      coverage,
    },
  ]);
  assert.match(prompt, /IMAGE_CONTENT:not-processed:1:parts/u);
  assert.match(prompt, /EMBEDDED_CONTENT:not-processed:1:parts/u);
  assert.ok(
    coverage.findings.some(
      (finding) =>
        finding.code === 'EMBEDDED_CONTENT' &&
        finding.locations.some((location) => location.part === 'word/embeddings/object.bin')
    )
  );
  assert.ok(document.units.every((unit) => !unit.text.includes('opaque embedded object')));
  assert.match(prompt, /text_coverage="partial"/u);
  assert.match(prompt, /content_features="[^"\n]*IMAGE_CONTENT:1:parts/u);
  assert.match(prompt, /not that the whole attachment has been read/u);
  assert.match(prompt, /Use original_path and the recorded locations/u);
});
