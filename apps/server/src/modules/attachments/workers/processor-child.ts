/**
 * @author root
 * @description Executes exactly one bounded attachment processing task in an isolated Node child and returns IPC V1 artifacts.
 */
import { DocumentProcessingError } from '@octopus/document-processing';
import {
  ArtifactManifestV1Schema,
  ProcessorStartV1Schema,
  StructuredDocumentV1Schema,
} from '@octopus/shared/protocol/attachments';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { extractDocument } from './document-extractor.js';
import { processPdf } from './pdf-processor.js';
import type {
  ArtifactManifestV1,
  ProcessorMessageV1,
  ProcessorStartV1,
  StructuredDocumentV1,
} from '@octopus/shared/protocol/attachments';

let terminal = false;
let heartbeat: NodeJS.Timeout | undefined;

process.once('message', (message: unknown) => {
  void run(ProcessorStartV1Schema.parse(message));
});

/**
 * Executes the sole task and guarantees one terminal IPC message.
 */
async function run(start: ProcessorStartV1): Promise<void> {
  heartbeat = setInterval(
    () => send({ protocol: 1, type: 'heartbeat', jobId: start.jobId, rssBytes: process.memoryUsage.rss() }),
    1_000
  );
  try {
    const inputPath = within(process.cwd(), start.input.relativePath);
    const outputDirectory = within(process.cwd(), start.outputDirectory);
    const format = formatFromMime(start.input.detectedMediaType);
    const source = ['docx', 'pptx', 'xlsx', 'zip'].includes(format)
      ? Buffer.alloc(0)
      : await readFile(inputPath);
    const sourceSha256 = ['docx', 'pptx', 'xlsx', 'zip'].includes(format)
      ? await sha256File(inputPath)
      : sha256(source);
    if (sourceSha256 !== start.input.sha256) {
      throw failure(
        'PROCESSOR_OUTPUT_INVALID',
        'Source checksum does not match the processing request.',
        false
      );
    }
    const manifest = await processSource(start, source, format, inputPath, outputDirectory);
    send({
      protocol: 1,
      type: 'heartbeat',
      jobId: start.jobId,
      rssBytes: process.memoryUsage.rss(),
    });
    terminal = true;
    send({
      protocol: 1,
      type: 'result',
      jobId: start.jobId,
      manifest: ArtifactManifestV1Schema.parse(manifest),
    });
  } catch (error) {
    terminal = true;
    const projected = projectError(error);
    send({ protocol: 1, type: 'error', jobId: start.jobId, ...projected });
  } finally {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
    }
    setImmediate(() => process.exit(terminal ? 0 : 1));
  }
}

/**
 * Routes admitted formats to bounded, non-executing parsers.
 */
async function processSource(
  start: ProcessorStartV1,
  source: Buffer,
  format: string,
  inputPath: string,
  outputDirectory: string
): Promise<ArtifactManifestV1> {
  send({ protocol: 1, type: 'progress', jobId: start.jobId, completed: 0, total: 1, phase: 'processing' });
  let document: StructuredDocumentV1 | undefined;
  const outputs: ArtifactManifestV1['outputs'] = [];
  let summary: ArtifactManifestV1['summary'] = {};
  if (['jpeg', 'png', 'webp'].includes(format)) {
    const { default: sharp } = await import('sharp');
    const image = sharp(source, { limitInputPixels: start.limits.maxImagePixels, failOn: 'error' }).rotate();
    const metadata = await image.metadata();
    const preview = await image
      .clone()
      .resize({ width: 1_280, height: 1_280, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const modelPipeline = image
      .clone()
      .resize({ width: 2_048, height: 2_048, fit: 'inside', withoutEnlargement: true });
    const model = metadata.hasAlpha
      ? await modelPipeline.png({ compressionLevel: 9 }).toBuffer()
      : await modelPipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    outputs.push(
      await writeOutput(outputDirectory, 'preview.webp', 'preview-image', 'image/webp', preview, {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
      })
    );
    outputs.push(
      await writeOutput(
        outputDirectory,
        metadata.hasAlpha ? 'model.png' : 'model.jpg',
        'model-image',
        metadata.hasAlpha ? 'image/png' : 'image/jpeg',
        model,
        {
          width: metadata.width ?? 0,
          height: metadata.height ?? 0,
        }
      )
    );
  } else if (format === 'pdf') {
    const pdfResult = await processPdf(source, start.limits);
    document = pdfResult.document;
    summary = pdfResult.summary;
  } else if (['docx', 'pptx', 'xlsx', 'zip'].includes(format)) {
    document = await extractDocument(
      inputPath,
      format,
      start.limits.maxExtractedCharacters,
      resolve(outputDirectory, 'scratch')
    );
  } else if (format === 'csv' || format === 'tsv') {
    const { parse: parseDelimited } = await import('csv-parse/sync');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
    const records = parseDelimited(text, {
      delimiter: format === 'csv' ? ',' : '\t',
      bom: true,
      relaxColumnCount: false,
      maxRecordSize: 1024 * 1024,
    }) as unknown[][];
    if (records.length > 200_000) {
      throw failure('PROCESSOR_RESOURCE_LIMIT_EXCEEDED', 'Delimited row limit exceeded.', false);
    }
    let cells = 0;
    const units: StructuredDocumentV1['units'] = [];
    for (const [index, record] of records.entries()) {
      cells += record.length;
      if (cells > 2_000_000) {
        throw failure('PROCESSOR_RESOURCE_LIMIT_EXCEEDED', 'Delimited cell limit exceeded.', false);
      }
      units.push({
        locator: { lineFrom: index + 1, lineTo: index + 1 },
        type: 'table',
        text: record.map(String).join('\t'),
      });
    }
    document = { schemaVersion: 1, kind: 'text', units, truncated: false, diagnostics: [] };
  } else if (['txt', 'markdown', 'json', 'source'].includes(format)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
    if (text.includes('\0')) {
      throw failure('PROCESSOR_PARSE_FAILED', 'Text attachment contains forbidden NUL bytes.', false);
    }
    if (format === 'json') {
      JSON.parse(text);
    }
    document = textDocument(
      format === 'source' ? 'source' : 'text',
      text,
      start.limits.maxExtractedCharacters
    );
  }
  if (document !== undefined) {
    const validated = StructuredDocumentV1Schema.parse(document);
    const bytes = Buffer.from(JSON.stringify(validated), 'utf8');
    outputs.push(
      await writeOutput(outputDirectory, 'document.json', 'document-json', 'application/json', bytes, {
        truncated: validated.truncated,
      })
    );
    const chunks = createChunks(validated);
    outputs.push(
      await writeOutput(
        outputDirectory,
        'chunks.jsonl',
        'chunks-jsonl',
        'application/x-ndjson',
        Buffer.from(chunks, 'utf8'),
        { chunkCount: chunks === '' ? 0 : chunks.trimEnd().split('\n').length }
      )
    );
    summary = {
      ...summary,
      ...(validated.coverage ? { coverage: validated.coverage } : {}),
      extractedCharacters: validated.units.reduce((sum, unit) => sum + unit.text.length, 0),
    };
  }
  send({ protocol: 1, type: 'progress', jobId: start.jobId, completed: 1, total: 1, phase: 'complete' });
  return {
    schemaVersion: 1,
    attachmentId: start.attachmentId,
    sourceSha256: start.input.sha256,
    processor: start.processor,
    outputs,
    summary,
  };
}

/**
 * Writes one output and returns its untrusted declaration for parent verification.
 */
async function writeOutput(
  directory: string,
  name: string,
  kind: ArtifactManifestV1['outputs'][number]['kind'],
  mimeType: string,
  bytes: Buffer,
  metadata: Record<string, string | number | boolean>
): Promise<ArtifactManifestV1['outputs'][number]> {
  const path = resolve(directory, name);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  return {
    localId: name,
    kind,
    relativePath: name,
    mimeType,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    metadata,
  };
}
/**
 * Builds a bounded structured text document.
 */
function textDocument(
  kind: StructuredDocumentV1['kind'],
  source: string,
  limit: number
): StructuredDocumentV1 {
  const text = source.slice(0, limit);
  return {
    schemaVersion: 1,
    kind,
    units: text.split(/\r?\n/).map((line, index) => ({
      locator: { lineFrom: index + 1, lineTo: index + 1 },
      type: kind === 'source' ? ('code' as const) : ('paragraph' as const),
      text: line,
    })),
    truncated: source.length > limit,
    diagnostics: source.length > limit ? ['TEXT_TRUNCATED'] : [],
  };
}
/**
 * Produces JSONL chunks without treating attachment content as control data.
 */
function createChunks(document: StructuredDocumentV1): string {
  let ordinal = 0;
  const chunks: string[] = [];
  for (const unit of document.units) {
    for (let offset = 0; offset < unit.text.length; offset += 4_000) {
      const text = unit.text.slice(offset, offset + 4_000);
      chunks.push(
        JSON.stringify({
          schemaVersion: 1,
          ordinal: ordinal++,
          locator: unit.locator,
          text,
          characterCount: text.length,
          tokenEstimate: Math.ceil(text.length / 4),
        })
      );
    }
  }
  return chunks.join('\n') + (ordinal === 0 ? '' : '\n');
}
/**
 * Maps the parent-verified media type into one worker processor family.
 */
function formatFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/json': 'json',
    'text/json': 'json',
    'text/csv': 'csv',
    'text/tab-separated-values': 'tsv',
    'text/markdown': 'markdown',
    'text/plain': 'txt',
    'text/x-source-code': 'source',
  };
  if (map[mime] !== undefined) {
    return map[mime];
  }
  if (mime.startsWith('text/') || mime.includes('javascript') || mime.includes('typescript')) {
    return 'source';
  }
  return mime.startsWith('audio/') || mime.startsWith('video/') ? 'media' : 'unknown';
}
/**
 * Resolves child paths below cwd and rejects traversal or absolute input.
 */
function within(root: string, target: string): string {
  if (isAbsolute(target)) {
    throw failure('PROCESSOR_PROTOCOL_VIOLATION', 'Absolute processor paths are forbidden.', false);
  }
  const resolved = resolve(root, target);
  const child = relative(root, resolved);
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw failure('PROCESSOR_PROTOCOL_VIOLATION', 'Processor path escapes its task root.', false);
  }
  return resolved;
}
/**
 * Calculates a lowercase SHA-256 digest.
 */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
/**
 * Calculates a lowercase SHA-256 digest without buffering a large source file.
 *
 * @param path Absolute path to the admitted source file.
 */
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}
/**
 * Sends one bounded IPC message when the parent channel remains connected.
 */
function send(message: ProcessorMessageV1): void {
  if (process.connected) {
    process.send?.(message);
  }
}
/**
 * Creates a stable worker failure value.
 */
function failure(
  code: string,
  message: string,
  retryable: boolean
): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable });
}
/**
 * Projects arbitrary parser failures without stack or path disclosure.
 */
function projectError(error: unknown): { code: string; retryable: boolean; message: string } {
  if (error instanceof DocumentProcessingError) {
    return {
      code:
        error.code === 'DOCUMENT_LIMIT' ? 'PROCESSOR_RESOURCE_LIMIT_EXCEEDED' : 'PROCESSOR_CONTENT_REJECTED',
      retryable: false,
      message: error.message,
    };
  }
  if (typeof error === 'object' && error !== null && 'code' in error && 'retryable' in error) {
    return {
      code: String(error.code),
      retryable: Boolean(error.retryable),
      message: error instanceof Error ? error.message : 'Attachment processing failed.',
    };
  }
  return { code: 'PROCESSOR_PARSE_FAILED', retryable: false, message: 'Attachment processing failed.' };
}
