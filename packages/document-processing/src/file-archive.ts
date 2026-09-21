/**
 * @author Codex
 * @description Traverses archive leaves sequentially using owned temporary files and one recursive expansion budget.
 */
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { documentFormat } from './archive.js';
import { zipDirectory, zipEntryChunks } from './file-zip.js';
import { consumeBudget, safeEntryName } from './zip.js';
import { DocumentProcessingError } from './types.js';
import type { ArchiveBudget } from './types.js';

export interface FileArchiveLeaf {
  path: string;
  localPath: string;
  format: string;
}
export interface ArchiveFileOptions {
  signal?: AbortSignal;
  temporaryDirectory?: string;
  budget?: ArchiveBudget;
}

/**
 * Keep one leaf alive until the consumer advances; never write archive-supplied filesystem paths.
 */
export async function* expandArchiveFile(
  name: string,
  path: string,
  options: ArchiveFileOptions = {},
  depth = 0
): AsyncGenerator<FileArchiveLeaf> {
  const budget = options.budget ?? {
    entries: 0,
    expandedBytes: 0,
    maxEntries: 2000,
    maxExpandedBytes: 256 * 1024 * 1024,
    maxEntryBytes: 100 * 1024 * 1024,
    maxDepth: 4,
  };
  options = { ...options, budget };
  options.signal?.throwIfAborted();
  if (depth === 0 && (await stat(path)).size > 100 * 1024 * 1024) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '压缩文件超过 100 MiB');
  }
  if (name.length > 4096) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '包内来源路径超过限制');
  }
  const format = documentFormat(name);
  if (!['zip', 'tar', 'gz', 'tgz'].includes(format)) {
    yield { path: name, localPath: path, format };
    return;
  }
  if (depth >= budget.maxDepth) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '压缩嵌套层数超过限制');
  }
  const directory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'octopus-archive-'));
  const target = join(directory, 'entry');
  try {
    if (format === 'zip') {
      let index = 0;
      for (const entry of await zipDirectory(path)) {
        options.signal?.throwIfAborted();
        await save(target, zipEntryChunks(path, entry, budget, options.signal));
        if (!entry.name.endsWith('/')) {
          yield* expandArchiveFile(`${name}/${++index}-${entry.name}`, target, options, depth + 1);
        }
        await rm(target, { force: true });
      }
    } else if (format === 'tar') {
      yield* tarLeaves(name, path, target, options, depth);
    } else {
      const size = (await stat(path)).size;
      const source = createReadStream(path, { signal: options.signal });
      const stream = createGunzip({ chunkSize: 16_384 });
      source.on('error', (error) => stream.destroy(error));
      source.pipe(stream);
      let expanded = 0;
      /**
       * Enforce gzip limits before persisting each output chunk.
       */
      async function* chunks(): AsyncGenerator<Buffer> {
        try {
          for await (const value of stream) {
            options.signal?.throwIfAborted();
            const chunk = value as Buffer;
            expanded += chunk.length;
            consumeBudget(budget, chunk.length, format === 'tgz' ? 0 : expanded);
            if (expanded > Math.max(1, size) * 100) {
              throw new DocumentProcessingError('DOCUMENT_LIMIT', 'GZIP 压缩比超过限制');
            }
            yield chunk;
          }
        } finally {
          source.destroy();
          stream.destroy();
        }
      }
      await save(target, chunks());
      if (format === 'tgz') {
        yield* tarLeaves(name, target, join(directory, 'leaf'), options, depth);
      } else {
        const leafName = name.split('/').at(-1)!.replace(/\.gz$/iu, '');
        yield* expandArchiveFile(`${name}/1-${leafName}`, target, options, depth + 1);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Serialize stream writes with backpressure and private, exclusively created files.
 */
async function save(path: string, chunks: AsyncIterable<Buffer>): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    for await (const chunk of chunks) {
      await file.writeFile(chunk);
    }
  } finally {
    await file.close();
  }
}

/**
 * Traverse regular USTAR files using bounded header reads; links and extended headers are rejected.
 */
async function* tarLeaves(
  name: string,
  path: string,
  target: string,
  options: ArchiveFileOptions,
  depth: number
): AsyncGenerator<FileArchiveLeaf> {
  const file = await open(path, 'r');
  const budget = options.budget!;
  try {
    const length = (await file.stat()).size;
    let index = 0;
    for (let offset = 0; offset + 512 <= length;) {
      options.signal?.throwIfAborted();
      const header = Buffer.alloc(512);
      if ((await file.read(header, 0, 512, offset)).bytesRead !== 512) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'TAR 头不完整');
      }
      if (header.every((byte) => byte === 0)) {
        return;
      }
      const expected = parseInt(header.subarray(148, 156).toString('ascii').replaceAll('\0', '').trim(), 8);
      const checksum = [...header].reduce(
        (sum, byte, position) => sum + (position >= 148 && position < 156 ? 32 : byte),
        0
      );
      const size = parseInt(header.subarray(124, 136).toString('ascii').replaceAll('\0', '').trim(), 8);
      if (checksum !== expected || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > length) {
        throw new DocumentProcessingError('ARCHIVE_INVALID', 'TAR 校验或大小无效');
      }
      const prefix = header.subarray(345, 500).toString('utf8').split('\0')[0]!;
      const basename = header.subarray(0, 100).toString('utf8').split('\0')[0]!;
      const entryName = safeEntryName(prefix ? `${prefix}/${basename}` : basename);
      budget.entries++;
      consumeBudget(budget, 0, size);
      const type = header[156];
      if (type === 0 || type === 48) {
        const start = offset + 512;
        /**
         * Account observed bytes while copying the current TAR member only.
         */
        async function* chunks(): AsyncGenerator<Buffer> {
          if (!size) {
            return;
          }
          for await (const value of createReadStream(path, {
            start,
            end: start + size - 1,
            highWaterMark: 16_384,
            signal: options.signal,
          })) {
            const chunk = value as Buffer;
            consumeBudget(budget, chunk.length, size);
            yield chunk;
          }
        }
        await save(target, chunks());
        yield* expandArchiveFile(`${name}/${++index}-${entryName}`, target, options, depth + 1);
        await rm(target, { force: true });
      } else if (type !== 53) {
        throw new DocumentProcessingError('ARCHIVE_UNSUPPORTED', 'TAR 链接、设备或扩展头不受支持');
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    throw new DocumentProcessingError('ARCHIVE_INVALID', 'TAR 缺少结束标记');
  } finally {
    await file.close();
  }
}
