/**
 * @author Codex
 * @description Reads bounded stable UTF-8 snapshots and paginates by raw bytes without splitting characters.
 */
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { BasicToolError } from './basic-inputs';
import type { ReadInput } from './basic-inputs';

const inputLimit = 16 * 1024 * 1024;
const outputLimit = 50 * 1024;

export type TextSnapshot = { bytes: Buffer; version: string };
export type ReadResult = {
  encoding?: 'base64';
  text: string;
  version: string;
  totalBytes: number;
  byteOffset: number;
  byteLength: number;
  truncated: boolean;
  next: { byteOffset: number; expectedVersion: string } | null;
};

/**
 * Includes file identity and mutation metadata; this is a race detector, not external atomic CAS.
 */
function metadata(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

/**
 * Rejects invalid UTF-8 and NUL-bearing binary data rather than decoding with replacement characters.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) {
      throw new BasicToolError('UNSUPPORTED_FILE', 'Binary files are not supported by this reader.');
    }
    return text;
  } catch (error) {
    if (error instanceof BasicToolError) {
      throw error;
    }
    throw new BasicToolError('INVALID_UTF8', 'The file must contain valid UTF-8 text.');
  }
}

/**
 * Reads at most 16 MiB plus one sentinel byte through one handle and verifies identity before returning.
 * Concurrent changes detected during reading fail instead of producing an observation.
 */
export async function readTextSnapshot(path: string): Promise<TextSnapshot> {
  const beforePath = await lstat(path, { bigint: true });
  if (!beforePath.isFile() || beforePath.isSymbolicLink() || (await realpath(path)) !== path) {
    throw new BasicToolError('FILE_CHANGED', 'The file path changed before reading.');
  }
  const handle = await open(path, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || metadata(before) !== metadata(beforePath)) {
      throw new BasicToolError('FILE_CHANGED', 'The file identity changed before reading.');
    }
    if (before.size > BigInt(inputLimit)) {
      throw new BasicToolError('FILE_TOO_LARGE', 'Text input is limited to 16 MiB.');
    }
    const chunks: Buffer[] = [];
    let length = 0;
    while (length <= inputLimit) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, inputLimit + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, length);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
    }
    if (length > inputLimit) {
      throw new BasicToolError('FILE_TOO_LARGE', 'Text input is limited to 16 MiB.');
    }
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(path, { bigint: true });
    if (
      metadata(before) !== metadata(after) ||
      metadata(after) !== metadata(afterPath) ||
      afterPath.isSymbolicLink() ||
      (await realpath(path)) !== path ||
      BigInt(length) !== after.size
    ) {
      throw new BasicToolError('FILE_CHANGED', 'The file changed while it was being read.');
    }
    const bytes = Buffer.concat(chunks, length);
    decodeText(bytes);
    const version = createHash('sha256')
      .update([before.dev, before.ino].join(':'))
      .update('\0')
      .update(bytes)
      .digest('hex');
    return { bytes, version };
  } finally {
    await handle.close();
  }
}

/**
 * Recognizes a UTF-8 continuation byte only after strict validation of the full snapshot.
 */
function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

/**
 * Returns a bounded page. Continuation offsets count original bytes, including an optional BOM.
 * Oversized lines advance by bytes; insufficient space for one code point fails with its required size.
 */
export function pageText(snapshot: TextSnapshot, input: ReadInput): ReadResult {
  const { bytes, version } = snapshot;
  const byteMode = input.byteOffset !== undefined || input.byteLimit !== undefined;
  const bomLength = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
  let start = byteMode ? (input.byteOffset ?? 0) : bomLength;
  if (start > bytes.length || (start > 0 && start < bomLength) || isContinuation(bytes[start])) {
    throw new BasicToolError(
      'INVALID_BYTE_OFFSET',
      'The offset must be a UTF-8 character boundary within the file.'
    );
  }
  if (start === 0) {
    start = bomLength;
  }
  if (!byteMode) {
    for (let line = 1; line < (input.offset ?? 1) && start < bytes.length; line++) {
      const newline = bytes.indexOf(0x0a, start);
      start = newline === -1 ? bytes.length : newline + 1;
    }
  }
  const budget = byteMode ? (input.byteLimit ?? outputLimit) : outputLimit;
  let end = Math.min(bytes.length, start + budget);
  while (end > start && isContinuation(bytes[end])) {
    end--;
  }
  if (end === start && start < bytes.length) {
    let required = 1;
    while (isContinuation(bytes[start + required])) {
      required++;
    }
    throw new BasicToolError(
      'BYTE_LIMIT_TOO_SMALL',
      `The next character requires at least ${required} bytes.`
    );
  }
  if (!byteMode) {
    let cursor = start;
    for (let line = 0; line < (input.limit ?? 2000); line++) {
      const newline = bytes.indexOf(0x0a, cursor);
      if (newline === -1 || newline >= end) {
        break;
      }
      cursor = newline + 1;
      if (line + 1 === (input.limit ?? 2000)) {
        end = cursor;
      }
    }
  }
  return {
    text: decodeText(bytes.subarray(start, end)),
    version,
    totalBytes: bytes.length,
    byteOffset: start,
    byteLength: end - start,
    truncated: end < bytes.length,
    next: end < bytes.length ? { byteOffset: end, expectedVersion: version } : null,
  };
}
