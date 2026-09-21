/**
 * @author Codex
 * @description Reads bounded ZIP directories and validates entry streams without retaining inflated archives.
 */
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInflateRaw, crc32 } from 'node:zlib';
import { DocumentProcessingError } from './types.js';
import { consumeBudget, safeEntryName } from './zip.js';
import type { ArchiveBudget } from './types.js';
import type { FileHandle } from 'node:fs/promises';

export interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
  crc: number;
  method: number;
  offset: number;
  flags: number;
}

/**
 * Read exact bounded metadata, rejecting truncated files before interpreting offsets.
 */
async function readAt(file: FileHandle, offset: number, size: number): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const result = await file.read(bytes, read, size - read, offset + read);
    if (!result.bytesRead) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 元数据不完整');
    }
    read += result.bytesRead;
  }
  return bytes;
}

/**
 * Inspect central and local headers without reading the compressed payload into memory.
 */
export async function zipDirectory(path: string): Promise<ZipEntry[]> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const tail = await readAt(file, Math.max(0, size - 65_557), Math.min(size, 65_557));
    let end = tail.length - 22;
    for (; end >= 0; end--) {
      if (tail.readUInt32LE(end) === 0x06054b50 && end + 22 + tail.readUInt16LE(end + 20) === tail.length) {
        break;
      }
    }
    if (end < 0 || tail.readUInt32LE(end + 4) !== 0) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 目录缺失或为分卷文件');
    }
    const count = tail.readUInt16LE(end + 10);
    const length = tail.readUInt32LE(end + 12);
    const start = tail.readUInt32LE(end + 16);
    if (count > 10_000 || length > 8 * 1024 * 1024) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', 'ZIP 元数据超过限制');
    }
    if (tail.readUInt16LE(end + 8) !== count || start + length !== size - tail.length + end) {
      throw new DocumentProcessingError('ARCHIVE_UNSUPPORTED', 'ZIP64 或分卷 ZIP 不受支持');
    }
    const directory = await readAt(file, start, length);
    const entries: ZipEntry[] = [];
    const names = new Set<string>();
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > length || directory.readUInt32LE(offset) !== 0x02014b50) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 中央目录无效');
      }
      const nameLength = directory.readUInt16LE(offset + 28);
      const next =
        offset + 46 + nameLength + directory.readUInt16LE(offset + 30) + directory.readUInt16LE(offset + 32);
      if (next > length) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 目录条目不完整');
      }
      const rawName = directory.subarray(offset + 46, offset + 46 + nameLength);
      const name = safeEntryName(new TextDecoder('utf-8', { fatal: true }).decode(rawName));
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const mode = directory.readUInt32LE(offset + 38) >>> 16;
      if (names.has(name) || flags & 1 || (mode & 0xf000) === 0xa000 || ![0, 8].includes(method)) {
        throw new DocumentProcessingError(
          'ARCHIVE_UNSUPPORTED',
          'ZIP 重复条目、加密、链接或压缩算法不受支持'
        );
      }
      names.add(name);
      const localOffset = directory.readUInt32LE(offset + 42);
      if (localOffset + 30 > start) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 本地头越界');
      }
      const local = await readAt(file, localOffset, 30);
      const localName = await readAt(file, localOffset + 30, local.readUInt16LE(26));
      if (
        local.readUInt32LE(0) !== 0x04034b50 ||
        local.readUInt16LE(6) !== flags ||
        local.readUInt16LE(8) !== method ||
        !localName.equals(rawName)
      ) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 本地头与目录不一致');
      }
      const entry: ZipEntry = {
        name,
        flags,
        method,
        size: directory.readUInt32LE(offset + 24),
        compressed: directory.readUInt32LE(offset + 20),
        crc: directory.readUInt32LE(offset + 16),
        offset: localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28),
      };
      if (
        entry.offset + entry.compressed > start ||
        entry.size === 0xffffffff ||
        entry.compressed === 0xffffffff
      ) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 数据范围无效');
      }
      entries.push(entry);
      offset = next;
    }
    if (offset !== length) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 目录长度无效');
    }
    return entries;
  } finally {
    await file.close();
  }
}

/**
 * Yield one entry with actual-byte limits and CRC verification; destroy owned streams on early return.
 */
export async function* zipEntryChunks(
  path: string,
  entry: ZipEntry,
  budget?: ArchiveBudget,
  signal?: AbortSignal
): AsyncGenerator<Buffer> {
  signal?.throwIfAborted();
  if (budget) {
    budget.entries++;
    consumeBudget(budget, 0, entry.size);
  }
  if (entry.size > Math.max(1, entry.compressed) * 100) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', 'ZIP 条目压缩比超过限制');
  }
  if (!entry.compressed) {
    if (entry.size || entry.crc) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 空条目校验失败');
    }
    return;
  }
  const source = createReadStream(path, {
    start: entry.offset,
    end: entry.offset + entry.compressed - 1,
    highWaterMark: 16_384,
    signal,
  });
  const inflate = entry.method === 8 ? createInflateRaw({ chunkSize: 16_384 }) : undefined;
  const stream = inflate ?? source;
  if (inflate) {
    source.on('error', (error) => inflate.destroy(error));
    source.pipe(inflate);
  }
  let size = 0;
  let checksum = 0;
  try {
    for await (const value of stream) {
      signal?.throwIfAborted();
      const chunk = value as Buffer;
      size += chunk.length;
      if (size > entry.size) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 实际大小与目录不符');
      }
      if (budget) {
        consumeBudget(budget, chunk.length, size);
      }
      checksum = crc32(chunk, checksum);
      yield chunk;
    }
    if (size !== entry.size || checksum !== entry.crc) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP CRC 或实际大小校验失败');
    }
  } finally {
    source.destroy();
    stream.destroy();
  }
}
