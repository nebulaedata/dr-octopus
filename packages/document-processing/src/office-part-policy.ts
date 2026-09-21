/**
 * @author Codex
 * @description Classifies Office package parts consistently for admission, opaque embedding handling and coverage.
 */
export type OfficePartKind = 'ordinary' | 'embedded' | 'active' | 'unsupported-binary';

/**
 * Allows standard embedding parts only as opaque data; active controls and macro parts remain forbidden.
 * This classification does not inspect, certify, expand or execute an embedded file's contents.
 */
export function classifyOfficePart(name: string): OfficePartKind {
  if (/vbaProject|\/activeX\//iu.test(name)) {
    return 'active';
  }
  if (/^(word|ppt|xl)\/embeddings\/.+/iu.test(name) && !name.endsWith('/')) {
    return 'embedded';
  }
  return /\.bin$/iu.test(name) ? 'unsupported-binary' : 'ordinary';
}
