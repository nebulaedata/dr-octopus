/**
 * @author Codex
 * @description Identifies supported visual inputs and separates clipboard image files from ordinary text paste.
 */

import type { ComposerAttachmentViewModel } from '@/stores/session';

export const COMPOSER_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const imageTypes = new Set(COMPOSER_IMAGE_ACCEPT.split(','));

/**
 * Recognizes browser-declared supported images; Server admission still verifies the actual file bytes.
 */
export function isComposerImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  return imageTypes.has(file.type) || (file.type === '' && /\.(png|jpe?g|webp)$/i.test(file.name));
}

/**
 * Uses local image intent until the authoritative Server presentation is available.
 */
export function isComposerImage(item: ComposerAttachmentViewModel): boolean {
  return item.localImage !== undefined || item.presentationKind === 'image';
}

/**
 * Reads file representations only, so HTML image URLs do not trigger remote downloads or duplicate images.
 */
export function clipboardImageFiles(data: Pick<DataTransfer, 'items'>): File[] {
  return Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null && isComposerImageFile(file));
}
