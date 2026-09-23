/**
 * @author Codex
 * @description Reads bounded image dimensions for attachment admission.
 */
import sharp from 'sharp';
import type { PreflightSource } from './types.js';
/**
 * Reads bounded image header dimensions before capability resolution.
 */
export async function inspectImageStructure(
  source: PreflightSource
): Promise<{ width?: number; height?: number }> {
  try {
    const metadata = await sharp(source.path, {
      limitInputPixels: 40_000_000,
      failOn: 'error',
    }).metadata();
    return {
      ...(metadata.width === undefined ? {} : { width: metadata.width }),
      ...(metadata.height === undefined ? {} : { height: metadata.height }),
    };
  } catch {
    return { width: 40_000_001, height: 1 };
  }
}
