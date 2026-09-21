/**
 * @author Codex
 * @description Owns PPTX part coverage rules, separate from extraction and UI wording.
 */
import type { PartFeature } from './types.js';
/**
 * Describes package parts; the collector determines whether the parser actually consumed them.
 */
export function classifyPart(part: string): PartFeature | undefined {
  if (/^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/u.test(part)) {
    return { code: 'TEXT_REGION', readableText: true };
  }
  if (/^ppt\/comments\//u.test(part)) {
    return { code: 'TEXT_REGION' };
  }
  return undefined;
}
