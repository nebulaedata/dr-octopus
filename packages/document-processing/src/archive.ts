/**
 * @author Codex
 * @description Recursive bounded ZIP/TAR/GZIP traversal retaining every leaf's source path.
 */
import { extname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DocumentProcessingError } from './types.js';
import { consumeBudget, readZip, safeEntryName } from './zip.js';
import type { ArchiveBudget, ArchiveLeaf } from './types.js';

/**
 * Recognize supported formats before treating Office ZIP containers as archives.
 */
export function documentFormat(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return 'tgz';
  }
  const extension = extname(lower).slice(1);
  return extension === 'markdown' ? 'md' : extension;
}

/**
 * Parse regular USTAR entries without writing archive-supplied paths to the filesystem.
 */
function readTar(bytes: Uint8Array, budget: ArchiveBudget): { name: string; bytes: Uint8Array }[] {
  const result: { name: string; bytes: Uint8Array }[] = [];
  const buffer = Buffer.from(bytes);
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      return result;
    }
    const checksum = parseInt(header.subarray(148, 156).toString('ascii').replaceAll('\0', '').trim(), 8);
    const actual = [...header].reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0
    );
    if (checksum !== actual) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'TAR 头校验失败');
    }
    const size = parseInt(header.subarray(124, 136).toString('ascii').replaceAll('\0', '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > buffer.length) {
      throw new DocumentProcessingError('ARCHIVE_INVALID', 'TAR 条目大小无效');
    }
    const prefix = header.subarray(345, 500).toString('utf8').split('\0')[0]!;
    const basename = header.subarray(0, 100).toString('utf8').split('\0')[0]!;
    const name = safeEntryName(prefix ? prefix + '/' + basename : basename);
    const type = header[156];
    budget.entries++;
    consumeBudget(budget, size, size);
    if (type === 0 || type === 48) {
      result.push({ name, bytes: buffer.subarray(offset + 512, offset + 512 + size) });
    } else if (type !== 53) {
      throw new DocumentProcessingError('ARCHIVE_UNSUPPORTED', 'TAR 链接、设备或扩展头不受支持');
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new DocumentProcessingError('ARCHIVE_INVALID', 'TAR 缺少结束标记');
}

/**
 * Enumerate related and unrelated leaf types; callers record unsupported leaves as skipped.
 * @deprecated Use expandArchiveFile for production imports to avoid retaining all inflated leaves.
 */
export function expandArchive(
  name: string,
  bytes: Uint8Array,
  budget: ArchiveBudget = {
    entries: 0,
    expandedBytes: 0,
    maxEntries: 2000,
    maxExpandedBytes: 1024 * 1024 * 1024,
    maxEntryBytes: 100 * 1024 * 1024,
    maxDepth: 4,
  },
  depth = 0
): ArchiveLeaf[] {
  const format = documentFormat(name);
  if (!['zip', 'tar', 'gz', 'tgz'].includes(format)) {
    return [{ path: name, bytes, format }];
  }
  if (depth >= budget.maxDepth) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '压缩嵌套层数超过限制');
  }
  let entries: { name: string; bytes: Uint8Array }[];
  if (format === 'zip') {
    entries = readZip(bytes, budget);
  } else if (format === 'tar') {
    entries = readTar(bytes, budget);
  } else {
    const inflated = gunzipSync(bytes, {
      maxOutputLength: Math.min(budget.maxExpandedBytes - budget.expandedBytes, 256 * 1024 * 1024),
    });
    if (inflated.length > bytes.length * 100) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', 'GZIP 压缩比超过限制');
    }
    consumeBudget(budget, inflated.length, format === 'tgz' ? 0 : inflated.length);
    entries =
      format === 'tgz'
        ? readTar(inflated, budget)
        : [{ name: name.split('/').at(-1)!.replace(/\.gz$/iu, ''), bytes: inflated }];
  }
  return entries.flatMap((entry, index) =>
    expandArchive(`${name}/${index + 1}-${entry.name}`, entry.bytes, budget, depth + 1)
  );
}
