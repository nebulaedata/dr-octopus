/**
 * @author Codex
 * @description Projects an exact edit's changed byte region with bounded UTF-8 previews, without storing source in journals.
 */
export type EditDiff = {
  byteOffset: number;
  removedBytes: number;
  addedBytes: number;
  before: string;
  after: string;
  truncated: boolean;
};

/**
 * Returns a preview below 4 KiB without splitting a UTF-8 code point.
 */
function preview(bytes: Buffer): string {
  let end = Math.min(4096, bytes.length);
  while (end > 0 && bytes[end] !== undefined && (bytes[end] & 0xc0) === 0x80) {
    end--;
  }
  return bytes.subarray(0, end).toString('utf8');
}

/**
 * Finds the common byte prefix/suffix, then exposes only changed-region previews.
 * Two 4 KiB previews remain below 50 KiB even with JSON escaping of ASCII control characters.
 */
export function describeEdit(before: Buffer, after: Buffer): EditDiff {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++;
  }
  while (start > 0 && ((before[start] & 0xc0) === 0x80 || (after[start] & 0xc0) === 0x80)) {
    start--;
  }
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  while (oldEnd < before.length && (before[oldEnd] & 0xc0) === 0x80) {
    oldEnd++;
    newEnd++;
  }
  const oldRegion = before.subarray(start, oldEnd);
  const newRegion = after.subarray(start, newEnd);
  const oldPreview = preview(oldRegion);
  const newPreview = preview(newRegion);
  return {
    byteOffset: start,
    removedBytes: oldRegion.length,
    addedBytes: newRegion.length,
    before: oldPreview,
    after: newPreview,
    truncated:
      Buffer.byteLength(oldPreview) < oldRegion.length || Buffer.byteLength(newPreview) < newRegion.length,
  };
}
