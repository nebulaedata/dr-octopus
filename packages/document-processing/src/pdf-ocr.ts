/**
 * @author Codex
 * @description Bounded regional OCR recovery for PDF pages whose full-page recognition is incomplete.
 */
import type { Canvas } from '@napi-rs/canvas';
import type { ParseOptions } from './types.js';

/**
 * Retry only incomplete recognition by bisecting the longer axis in reading order.
 * Two split levels bound each page to seven requests. Overlap protects characters on
 * region edges; all regions must succeed before any recovered page text is returned.
 * The caller owns the original canvas; every temporary canvas is released here.
 */
export async function recognizePdfPage(
  canvas: Canvas,
  recognize: NonNullable<ParseOptions['recognizePage']>,
  signal?: AbortSignal,
  depth = 0
): Promise<string> {
  signal?.throwIfAborted();
  try {
    return await recognize(await canvas.encode('png'), signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'OCR_INCOMPLETE' ||
      depth >= 2 ||
      Math.max(canvas.width, canvas.height) < 128
    ) {
      throw error;
    }
    const { createCanvas } = await import('@napi-rs/canvas');
    const horizontal = canvas.width > canvas.height;
    const length = horizontal ? canvas.width : canvas.height;
    const middle = Math.floor(length / 2);
    const texts: string[] = [];
    for (const [start, end] of [
      [0, middle + 24],
      [middle - 24, length],
    ] as const) {
      signal?.throwIfAborted();
      const width = horizontal ? end - start : canvas.width;
      const height = horizontal ? canvas.height : end - start;
      const region = createCanvas(width, height);
      try {
        region
          .getContext('2d')
          .drawImage(
            canvas,
            horizontal ? start : 0,
            horizontal ? 0 : start,
            width,
            height,
            0,
            0,
            width,
            height
          );
        texts.push(await recognizePdfPage(region, recognize, signal, depth + 1));
      } finally {
        region.width = 1;
        region.height = 1;
      }
    }
    return texts.join('\n');
  }
}
