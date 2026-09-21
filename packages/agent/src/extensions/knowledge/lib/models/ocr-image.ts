/**
 * @author Codex
 * @description Identifies bounded OCR image payloads without decoding, converting or assuming provider support.
 */
import { KnowledgeError } from '../../definitions/error.js';
import { OCR_MODEL_BYTES } from '../../definitions/ocr-image.js';

/**
 * Inspect content signatures rather than filenames; providers own image decoding and format support errors.
 */
export function ocrImageMime(image: Uint8Array, maxBytes = OCR_MODEL_BYTES): string {
  if (!image.byteLength || image.byteLength > maxBytes) {
    throw new KnowledgeError('INVALID_INPUT', `OCR 图片为空或超过 ${maxBytes / 1024 / 1024} MiB`);
  }
  const bytes = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
  const prefix = bytes.subarray(0, 16).toString('hex');
  if (prefix.startsWith('89504e470d0a1a0a')) {
    return 'image/png';
  }
  if (prefix.startsWith('ffd8ff')) {
    return 'image/jpeg';
  }
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    return 'image/gif';
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (prefix.startsWith('424d')) {
    return 'image/bmp';
  }
  if (['49492a00', '4d4d002a', '49492b00', '4d4d002b'].some((magic) => prefix.startsWith(magic))) {
    return 'image/tiff';
  }
  if (prefix.startsWith('00000100')) {
    return 'image/vnd.microsoft.icon';
  }
  if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const end = bytes.readUInt32BE(0);
    if (end >= 16 && end <= bytes.length) {
      const brands = [bytes.toString('ascii', 8, 12)];
      for (let offset = 16; offset + 4 <= end; offset += 4) {
        brands.push(bytes.toString('ascii', offset, offset + 4));
      }
      if (brands.includes('avis')) {
        return 'image/avif';
      }
      if (brands.includes('avif')) {
        return 'image/avif';
      }
      if (brands.some((brand) => ['hevc', 'hevx'].includes(brand))) {
        return 'image/heic-sequence';
      }
      if (brands.some((brand) => ['heic', 'heix', 'heim', 'heis'].includes(brand))) {
        return 'image/heic';
      }
      if (brands.includes('msf1')) {
        return 'image/heif-sequence';
      }
      if (brands.includes('mif1')) {
        return 'image/heif';
      }
    }
  }
  const prolog = bytes
    .subarray(0, 65536)
    .toString('utf8')
    .replace(/^\uFEFF/u, '');
  const root = prolog.replace(
    /^\s*(?:(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg\b(?:[^>"'[]|"[^"]*"|'[^']*'|\[[\s\S]*?\])*>)[\s]*)*/iu,
    ''
  );
  if (/^<(?:[\w.-]+:)?svg(?=[\s/>])/u.test(root)) {
    return 'image/svg+xml';
  }
  throw new KnowledgeError(
    'INVALID_INPUT',
    '无法识别图片类型；支持 PNG、JPEG、WebP、GIF、BMP、TIFF、ICO、AVIF、HEIC、HEIF、SVG，暂不支持 PDF'
  );
}
