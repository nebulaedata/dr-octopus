/**
 * @author Codex
 * @description Verifies ZIP admission, isolated processing, member locators and explicit partial outcomes.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { ProcessorSupervisor } from '../dist/modules/attachments/workers/processor-supervisor.js';
import { extractDocument } from '../dist/modules/attachments/workers/document-extractor.js';
import { collectAttachmentEvidence } from '../dist/modules/attachments/attachments.utils.js';
import {
  createAttachmentCapabilityResolver,
  DEFAULT_ATTACHMENT_POLICY,
} from '../dist/infrastructure/attachment-capability/index.js';

const limits = {
  wallTimeMs: 120_000,
  maxRssBytes: 1024 * 1024 * 1024,
  maxOutputBytes: 10_000_000,
  maxOutputFiles: 10,
  maxImagePixels: 40_000_000,
  maxPages: 500,
  maxExtractedCharacters: 100_000,
};

test('ZIP bytes are admitted and produce document/chunk artifacts with original member paths', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-zip-attachment-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = zipSync(
    {
      'folder/notes.txt': strToU8('ZIP 内的说明'),
      'long.txt': strToU8('a'.repeat(4500)),
      'nested.zip': zipSync({ 'readme.md': strToU8('嵌套文档') }, { level: 0 }),
      'image.bin': new Uint8Array([1]),
      'broken.docx': strToU8('invalid'),
    },
    { level: 0 }
  );
  const sourcePath = join(directory, 'source.zip');
  await writeFile(sourcePath, source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const evidence = await collectAttachmentEvidence(
    {
      name: 'source.zip',
      declaredMediaType: 'application/zip',
      byteSize: source.length,
      sha256,
      storageKey: 'source.zip',
    },
    { resolveForProcessor: () => sourcePath }
  );
  const resolution = createAttachmentCapabilityResolver().resolve(evidence, {
    processors: new Set(['archive-text-extract']),
    retrieval: new Set(['structured-file-read']),
    tools: new Set(['read-file']),
    policy: DEFAULT_ATTACHMENT_POLICY,
  });
  assert.equal(resolution.decision, 'allow');
  assert.deepEqual(resolution.processingPlan.steps, ['archive-text-extract']);
  const jobId = randomUUID();
  const result = await new ProcessorSupervisor(directory).run({
    jobId,
    attachmentId: randomUUID(),
    sourceKey: 'source.zip',
    sha256,
    detectedMediaType: 'application/zip',
    limits,
  });
  const document = JSON.parse(
    await readFile(join(directory, result.outputKeys.get('document.json')), 'utf8')
  );
  assert.equal(document.kind, 'zip');
  assert.deepEqual(
    document.units.map((unit) => unit.text),
    ['ZIP 内的说明', 'a'.repeat(4500), '嵌套文档']
  );
  assert.equal(document.units[0].locator.archivePath, 'archive.zip/1-folder/notes.txt');
  assert.ok(document.diagnostics.some((notice) => notice.startsWith('ARCHIVE_SKIPPED:')));
  assert.ok(document.diagnostics.some((notice) => notice.startsWith('ARCHIVE_FAILED:')));
  const chunks = (await readFile(join(directory, result.outputKeys.get('chunks.jsonl')), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(chunks[3].locator.archivePath, 'archive.zip/3-nested.zip/1-readme.md');
  assert.equal(chunks[1].text + chunks[2].text, 'a'.repeat(4500));
  assert.ok(!(await readdir(join(directory, 'staging/jobs', jobId))).includes('scratch'));
});

test('ZIP extraction shares one text budget and rejects corrupt outer archives instead of publishing partial text', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-zip-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'source.zip');
  await writeFile(
    path,
    zipSync({ 'first.txt': strToU8('123456'), 'last.txt': strToU8('abcdef') }, { level: 0 })
  );
  const document = await extractDocument(path, 'zip', 4, directory);
  assert.equal(document.units[0].text, '1234');
  assert.equal(document.truncated, true);
  assert.ok(document.diagnostics.some((notice) => notice.includes('last.txt')));
  const corrupt = zipSync({ 'first.txt': strToU8('one') }, { level: 0 });
  corrupt[39] ^= 1;
  await writeFile(path, corrupt);
  await assert.rejects(extractDocument(path, 'zip', 4, directory), { code: 'ARCHIVE_INVALID' });
  assert.deepEqual(await readdir(directory), ['source.zip']);
});
