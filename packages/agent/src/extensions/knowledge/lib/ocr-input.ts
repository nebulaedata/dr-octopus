/**
 * @author Codex
 * @description Reads bounded local image inputs from absolute paths or paths resolved against the active workspace.
 */
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';
import { ocrImageMime } from './models/ocr-image.js';
import { OCR_SOURCE_BYTES } from '../definitions/ocr-image.js';

/**
 * Resolve the actual local target before reading; absolute paths do not depend on workspace availability.
 */
export async function readOcrInput(cwd: string, input: string, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const path = await realpath(isAbsolute(input) ? input : resolve(cwd, input));
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !stat.size || stat.size > OCR_SOURCE_BYTES) {
      throw new KnowledgeError('INVALID_INPUT', 'OCR 只接受不超过 100 MiB 的非空图片文件');
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) {
        throw new KnowledgeError('INVALID_INPUT', 'OCR 文件在读取期间发生变化');
      }
      offset += bytesRead;
    }
    ocrImageMime(bytes, OCR_SOURCE_BYTES);
    return bytes;
  } finally {
    await file.close();
  }
}
