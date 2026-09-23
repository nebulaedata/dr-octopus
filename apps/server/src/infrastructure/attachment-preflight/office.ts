/**
 * @author Codex
 * @description Inspects bounded Office container metadata without expanding entries.
 */
import { classifyOfficePart } from '@octopus/document-processing/office-policy';
import type { PreflightSource } from './types.js';
import type { SupportedAttachmentFormat } from '../attachment-capability/index.js';
interface OfficeContainerEvidence {
  valid: boolean;
  entryCount: number;
  uncompressedBytes: number;
  hasMacros: boolean;
  hasActiveContent: boolean;
  hasEmbeddedObject: boolean;
}

/**
 * Parses bounded ZIP central-directory records without expanding attacker-controlled entries.
 */
export async function inspectOfficeContainer(
  format: SupportedAttachmentFormat | 'unknown',
  byteSize: number,
  source: PreflightSource
): Promise<OfficeContainerEvidence> {
  const start = Math.max(0, byteSize - Math.min(byteSize, 8 * 1024 * 1024));
  const { stream } = await source.openRead({ start, end: byteSize - 1 });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const directory = Buffer.concat(chunks);
  const names = new Set<string>();
  let entryCount = 0;
  let uncompressedBytes = 0;
  for (let offset = 0; offset + 46 <= directory.length;) {
    if (directory.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > directory.length) {
      break;
    }
    names.add(directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    entryCount += 1;
    uncompressedBytes += directory.readUInt32LE(offset + 24);
    offset = end;
  }
  let required: 'word/document.xml' | 'xl/workbook.xml' | 'ppt/presentation.xml';
  if (format === 'docx') {
    required = 'word/document.xml';
  } else {
    if (format === 'xlsx') {
      required = 'xl/workbook.xml';
    } else {
      required = 'ppt/presentation.xml';
    }
  }
  return {
    valid: names.has('[Content_Types].xml') && names.has(required),
    entryCount,
    uncompressedBytes,
    hasMacros: [...names].some((name) => /vbaProject\.bin$/iu.test(name)),
    hasActiveContent: [...names].some((name) => classifyOfficePart(name) === 'active'),
    hasEmbeddedObject: [...names].some((name) => classifyOfficePart(name) === 'embedded'),
  };
}
