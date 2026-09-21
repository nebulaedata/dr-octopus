/**
 * @author Codex
 * @description Stream ZIP inflation through shared actual-byte budgets without extracting file paths.
 */
import { Unzip, UnzipInflate } from 'fflate';
import { crc32 } from 'node:zlib';
import { DocumentProcessingError } from './types.js';
import type { ArchiveBudget } from './types.js';

/**
 * Validate archive names even though entries are never written to their supplied paths.
 */
export function safeEntryName(name: string): string {
  const path = name.replaceAll('\\', '/');
  if (
    !path ||
    path.startsWith('/') ||
    path.includes(':') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new DocumentProcessingError('ARCHIVE_PATH_INVALID', '压缩文件包含非法路径');
  }
  return path;
}

/**
 * Enforce actual decompressed bytes across every nested container, not just ZIP header sizes.
 */
export function consumeBudget(budget: ArchiveBudget, bytes: number, entryBytes: number): void {
  budget.expandedBytes += bytes;
  if (
    budget.entries > budget.maxEntries ||
    budget.expandedBytes > budget.maxExpandedBytes ||
    entryBytes > budget.maxEntryBytes
  ) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '压缩文件超过累计解压限制');
  }
}

/**
 * Inflate entries incrementally and validate count, stream sizes and compression ratio.
 */
export function readZip(source: Uint8Array, budget: ArchiveBudget): { name: string; bytes: Uint8Array }[] {
  const expected = centralDirectory(source);
  const output: { name: string; bytes: Uint8Array }[] = [];
  let complete = 0;
  let started = 0;
  let expanded = 0;
  const archive = new Unzip((file) => {
    const metadata = expected[started];
    if (!metadata) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 本地头与目录不一致');
    }
    const name = safeEntryName(file.name);
    budget.entries++;
    consumeBudget(budget, 0, 0);
    if (file.originalSize && file.originalSize > budget.maxEntryBytes) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', '压缩条目超过单文件大小限制');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let checksum = 0;
    started++;
    file.ondata = (error, chunk, final) => {
      if (error) {
        if (error instanceof DocumentProcessingError) {
          throw error;
        }
        throw new DocumentProcessingError('ARCHIVE_INVALID', '压缩数据损坏或不支持');
      }
      size += chunk.length;
      checksum = crc32(chunk, checksum);
      expanded += chunk.length;
      consumeBudget(budget, chunk.length, size);
      if (expanded > source.length * 100) {
        throw new DocumentProcessingError('DOCUMENT_LIMIT', '压缩文件的实际压缩比超过限制');
      }
      chunks.push(chunk);
      if (final) {
        if (checksum !== metadata.crc || size !== metadata.size) {
          throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP CRC 或实际大小校验失败');
        }
        complete++;
        if (!name.endsWith('/')) {
          output.push({ name, bytes: Buffer.concat(chunks) });
        }
      }
    };
    file.start();
  });
  archive.register(UnzipInflate);
  for (let offset = 0; offset < source.length; offset += 16_384) {
    archive.push(source.subarray(offset, offset + 16_384), offset + 16_384 >= source.length);
  }
  if (complete !== started || started !== expected.length || !started) {
    throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 条目不完整');
  }
  return output;
}

/**
 * Reject encrypted, split, ZIP64 and symlink entries before inflation, and collect CRC expectations.
 */
function centralDirectory(source: Uint8Array): { offset: number; crc: number; size: number }[] {
  const bytes = Buffer.from(source);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65_557); end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) {
      break;
    }
  }
  if (
    end < Math.max(0, bytes.length - 65_557) ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  ) {
    throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 目录缺失或为分卷文件');
  }
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (count === 65535 || offset === 0xffffffff) {
    throw new DocumentProcessingError('ARCHIVE_UNSUPPORTED', '当前大小限制下不支持 ZIP64');
  }
  const result: { offset: number; crc: number; size: number }[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'ZIP 中央目录无效');
    }
    const mode = bytes.readUInt32LE(offset + 38) >>> 16;
    if ((bytes.readUInt16LE(offset + 8) & 1) !== 0 || (mode & 0xf000) === 0xa000) {
      throw new DocumentProcessingError('ARCHIVE_UNSUPPORTED', '加密 ZIP 或符号链接不受支持');
    }
    result.push({
      offset: bytes.readUInt32LE(offset + 42),
      crc: bytes.readUInt32LE(offset + 16),
      size: bytes.readUInt32LE(offset + 24),
    });
    offset +=
      46 +
      bytes.readUInt16LE(offset + 28) +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
  }
  return result.sort((a, b) => a.offset - b.offset);
}

/**
 * Bound Office containers separately while preserving the same parser safety rules.
 */
export function officeEntries(bytes: Uint8Array, required: string): Map<string, Uint8Array> {
  const items = readZip(bytes, {
    entries: 0,
    expandedBytes: 0,
    maxEntries: 10_000,
    maxExpandedBytes: 512 * 1024 * 1024,
    maxEntryBytes: 100 * 1024 * 1024,
    maxDepth: 1,
  });
  const result = new Map<string, Uint8Array>();
  for (const item of items) {
    if (result.has(item.name) || /vbaProject|\/embeddings\/|\.bin$/iu.test(item.name)) {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 包含重复、活动或嵌入内容');
    }
    if (
      item.name.endsWith('.rels') &&
      /TargetMode\s*=\s*["']External["']/iu.test(Buffer.from(item.bytes).toString('utf8'))
    ) {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 外部关系不受支持');
    }
    result.set(item.name, item.bytes);
  }
  if (!result.has(required) || !result.has('[Content_Types].xml')) {
    throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 容器格式无效');
  }
  return result;
}
