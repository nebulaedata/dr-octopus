/**
 * @author Codex
 * @description Validates durable image receipts without parsing model-facing prose.
 */
import { isRecord } from './tool-renderer-utils';
import type { ImagegenResult } from '@octopus/shared/protocol';

/**
 * Rejects unknown versions, malformed images and paths that cannot address workspace files.
 */
export function projectImagegen(value: unknown): ImagegenResult | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.providerId !== 'string' ||
    typeof value.modelId !== 'string' ||
    !Array.isArray(value.images) ||
    !value.images.length ||
    value.images.length > 8
  ) {
    return undefined;
  }
  if (
    !value.images.every(
      (image) =>
        isRecord(image) &&
        typeof image.path === 'string' &&
        typeof image.relativePath === 'string' &&
        image.relativePath.length > 0 &&
        !image.relativePath.startsWith('/') &&
        !image.relativePath.includes('\\') &&
        !image.relativePath.includes(':') &&
        !image.relativePath.split('/').includes('..') &&
        ['image/png', 'image/jpeg', 'image/webp'].includes(String(image.mimeType)) &&
        typeof image.width === 'number' &&
        Number.isSafeInteger(image.width) &&
        image.width > 0 &&
        typeof image.height === 'number' &&
        Number.isSafeInteger(image.height) &&
        image.height > 0
    )
  ) {
    return undefined;
  }
  return value as unknown as ImagegenResult;
}
