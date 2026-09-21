/**
 * @author Codex
 * @description Separates source admission, model byte budgets and observable OCR image preparation results.
 */
export const OCR_SOURCE_BYTES = 100 * 1024 * 1024;
export const OCR_MODEL_BYTES = 20 * 1024 * 1024;
export const OCR_MAX_PIXELS = 40_000_000;

export interface OcrImageDescription {
  byteSize: number;
  mimeType: string;
  width?: number;
  height?: number;
  pages?: number;
}
export interface OcrImagePreparation {
  source: OcrImageDescription;
  sent: OcrImageDescription;
  method: 'original' | 'png-lossless' | 'jpeg' | 'svg-to-png';
  lossy: boolean;
  quality?: number;
}
export interface PreparedOcrImage {
  bytes: Uint8Array;
  preparation: OcrImagePreparation;
}
