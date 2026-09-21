/**
 * @author Codex
 * @description Owns DOCX part coverage rules, separate from extraction and UI wording.
 */
import type { PartFeature } from './types.js';
/**
 * Describes package parts; the collector determines whether the parser actually consumed them.
 */
export function classifyPart(part: string): PartFeature | undefined {
  if (/^word\/(header\d+|footer\d+|footnotes|endnotes|document)\.xml$/u.test(part)) {
    return { code: 'TEXT_REGION', readableText: true };
  }
  if (/^word\/comments[^/]*\.xml$/u.test(part)) {
    return { code: 'TEXT_REGION' };
  }
  return undefined;
}
