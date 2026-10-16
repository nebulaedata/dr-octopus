/**
 * @author Codex
 * @description Prepares an all-or-nothing exact edit against one original UTF-8 snapshot; never publishes files.
 */
import type { EditInput } from './basic-inputs';
import { BasicToolError } from './basic-inputs';
import { decodeText } from './text-file';

export type EditPlan = { content: Buffer; changed: boolean; replacements: number };

/**
 * Rejects lone surrogates before Node can silently replace them during UTF-8 encoding.
 */
function assertUnicode(text: string): void {
  if (!text.isWellFormed()) {
    throw new BasicToolError('INVALID_TEXT', 'Edit text must contain complete Unicode characters.');
  }
}

/**
 * Normalizes only CRLF/LF; lone CR is unsupported rather than guessed.
 */
function normalizeLines(text: string): string {
  const normalized = text.replaceAll('\r\n', '\n');
  if (normalized.includes('\r')) {
    throw new BasicToolError('UNSUPPORTED_LINE_ENDINGS', 'Lone CR line endings are not supported.');
  }
  return normalized;
}

/**
 * Validates every replacement against the same original and preserves its BOM and uniform line ending.
 * Repeated matches (including overlapping occurrences), overlapping edits and oversized results reject the batch.
 */
export function prepareEdit(bytes: Buffer, edits: EditInput['edits']): EditPlan {
  if (bytes.length > 16 * 1024 * 1024 || edits.length < 1 || edits.length > 100) {
    throw new BasicToolError('EDIT_TOO_LARGE', 'Edit input exceeds the supported limits.');
  }
  let original = decodeText(bytes);
  const bom = original.startsWith('\ufeff');
  if (bom) {
    original = original.slice(1);
  }
  const hasCrLf = original.includes('\r\n');
  const hasLf = original.replaceAll('\r\n', '').includes('\n');
  if (hasCrLf && hasLf) {
    throw new BasicToolError('UNSUPPORTED_LINE_ENDINGS', 'Mixed source line endings cannot be edited.');
  }
  const source = normalizeLines(original);
  let replacementBytes = 0;
  const replacements = edits.map(({ oldText, newText }) => {
    assertUnicode(oldText);
    assertUnicode(newText);
    replacementBytes += Buffer.byteLength(oldText) + Buffer.byteLength(newText);
    if (replacementBytes > 8 * 1024 * 1024 || oldText.length === 0 || newText.includes('\0')) {
      throw new BasicToolError('INVALID_EDIT', 'Replacement text is empty, binary or exceeds 8 MiB.');
    }
    const old = normalizeLines(oldText);
    const replacement = normalizeLines(newText);
    const start = source.indexOf(old);
    if (start === -1) {
      throw new BasicToolError('EDIT_NOT_FOUND', 'An edit does not match the original text.');
    }
    if (source.indexOf(old, start + 1) !== -1) {
      throw new BasicToolError('EDIT_AMBIGUOUS', 'An edit matches more than once in the original text.');
    }
    return { start, end: start + old.length, replacement };
  });
  replacements.sort((left, right) => left.start - right.start);
  for (let index = 1; index < replacements.length; index++) {
    if (replacements[index].start < replacements[index - 1].end) {
      throw new BasicToolError('EDIT_OVERLAP', 'Edits must not overlap in the original text.');
    }
  }
  let content = source;
  for (const edit of replacements.toReversed()) {
    content = content.slice(0, edit.start) + edit.replacement + content.slice(edit.end);
  }
  if (hasCrLf) {
    content = content.replaceAll('\n', '\r\n');
  }
  if (bom) {
    content = '\ufeff' + content;
  }
  const encoded = Buffer.from(content, 'utf8');
  if (encoded.length > 16 * 1024 * 1024) {
    throw new BasicToolError('EDIT_TOO_LARGE', 'The edited file exceeds 16 MiB.');
  }
  return { content: encoded, changed: !encoded.equals(bytes), replacements: replacements.length };
}
