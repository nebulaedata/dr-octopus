/**
 * @author Codex
 * @description Rasterizes SVG and prepares oversized OCR images without resizing raster inputs or dropping frames.
 */
import sharp from 'sharp';
import { KnowledgeError } from '../definitions/error.js';
import { OCR_MAX_PIXELS, OCR_MODEL_BYTES, OCR_SOURCE_BYTES } from '../definitions/ocr-image.js';
import { ocrImageMime } from './models/ocr-image.js';
import type { Metadata } from 'sharp';
import type { PreparedOcrImage, OcrImageDescription } from '../definitions/ocr-image.js';

/**
 * Render SVG to PNG; preserve bounded raster inputs and compress larger ones at original display resolution.
 * Unknown codecs may pass through within budget, but cannot be silently reduced to their first page.
 */
export async function prepareOcrImage(
  bytes: Buffer,
  maxOutputBytes = OCR_MODEL_BYTES
): Promise<PreparedOcrImage> {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > OCR_MODEL_BYTES) {
    throw new KnowledgeError('INVALID_INPUT', 'OCR 模型图片预算无效');
  }
  const mimeType = ocrImageMime(bytes, OCR_SOURCE_BYTES);
  const svg = mimeType === 'image/svg+xml';
  const source: OcrImageDescription = { byteSize: bytes.length, mimeType };
  sharp.cache(false);
  sharp.concurrency(1);
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: OCR_MAX_PIXELS }).metadata();
  } catch {
    if (!svg && bytes.length <= maxOutputBytes) {
      return { bytes, preparation: { source, sent: { ...source }, method: 'original', lossy: false } };
    }
    throw new KnowledgeError(
      'OCR_IMAGE_PREPARATION_FAILED',
      '图片无法解码或转换，SVG 必须成功转成 PNG；请检查文件或先转换、拆分图片'
    );
  }
  Object.assign(source, { width: metadata.width, height: metadata.height, pages: metadata.pages ?? 1 });
  if (!svg && bytes.length <= maxOutputBytes) {
    return { bytes, preparation: { source, sent: { ...source }, method: 'original', lossy: false } };
  }
  if ((metadata.pages ?? 1) > 1 || mimeType.endsWith('-sequence') || hasAnimationContainer(bytes, mimeType)) {
    throw new KnowledgeError(
      'OCR_IMAGE_MULTIFRAME',
      '多帧或多页图片超过模型预算，请先逐帧或逐页拆分；不会只识别第一帧'
    );
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > OCR_MAX_PIXELS) {
    throw new KnowledgeError('OCR_IMAGE_PIXEL_LIMIT', '图片超过 4000 万像素或尺寸未知，请先分块处理');
  }
  try {
    for (const quality of [undefined, 90, 85]) {
      if (quality !== undefined && (metadata.hasAlpha || svg)) {
        break;
      }
      const pipeline = sharp(bytes, { limitInputPixels: OCR_MAX_PIXELS, failOn: 'error' })
        .rotate()
        .timeout({ seconds: 25 });
      const { data, info } = await (
        quality === undefined
          ? pipeline.png({ compressionLevel: 9 })
          : pipeline.jpeg({ quality, chromaSubsampling: '4:4:4' })
      ).toBuffer({ resolveWithObject: true });
      if (data.length <= maxOutputBytes) {
        return {
          bytes: data,
          preparation: {
            source,
            sent: {
              byteSize: data.length,
              mimeType: quality === undefined ? 'image/png' : 'image/jpeg',
              width: info.width,
              height: info.height,
              pages: 1,
            },
            method: svg ? 'svg-to-png' : quality === undefined ? 'png-lossless' : 'jpeg',
            lossy: quality !== undefined,
            ...(quality === undefined ? {} : { quality }),
          },
        };
      }
    }
  } catch {
    throw new KnowledgeError('OCR_IMAGE_PREPARATION_FAILED', '图片压缩失败或超时，请先转换或分块处理');
  }
  throw new KnowledgeError(
    'OCR_IMAGE_BUDGET_EXCEEDED',
    '保留分辨率压缩后仍超过模型预算，请先分块或明确缩小图片；未裁剪、缩小或覆盖原文件'
  );
}

/**
 * Detect animated PNG/AVIF containers even when the installed decoder exposes only their default image.
 */
function hasAnimationContainer(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') {
        return true;
      }
      offset += size + 12;
    }
  }
  if (mime === 'image/avif') {
    const end = Math.min(bytes.readUInt32BE(0), bytes.length);
    for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
      if (bytes.toString('ascii', offset, offset + 4) === 'avis') {
        return true;
      }
    }
  }
  return false;
}
