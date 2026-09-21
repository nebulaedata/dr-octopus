/**
 * @author Codex
 * @description Owns XLSX part coverage rules, separate from extraction and UI wording.
 */
import type { PartFeature } from './types.js';
/**
 * Describes package parts; the collector determines whether the parser actually consumed them.
 */
export function classifyPart(part: string): PartFeature | undefined {
  if (/^xl\/worksheets\/[^/]+\.xml$/u.test(part)) {
    return { code: 'TEXT_REGION', readableText: true };
  }
  if (/^xl\/(comments|threadedComments)/u.test(part)) {
    return { code: 'TEXT_REGION' };
  }
  if (/^xl\/externalLinks\//u.test(part)) {
    return { code: 'EMBEDDED_CONTENT' };
  }
  return undefined;
}
