/**
 * @author Codex
 * @description Copies browser text with a legacy fallback when the Clipboard API is unavailable.
 */

/**
 * Writes text from a user gesture, restoring focus and selection after legacy copying.
 *
 * @throws When neither clipboard mechanism can copy the text.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Browser permissions may block the modern API while legacy copying still works.
    }
  }

  const active = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : [];
  const inputSelection =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
      : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;';
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (!document.execCommand('copy')) {
      // Diagnostic only: copyTextWithFeedback replaces this with localized guidance.
      throw new Error('document.execCommand copy was rejected.');
    }
  } finally {
    textarea.remove();
    if (active instanceof HTMLElement) {
      active.focus({ preventScroll: true });
    }
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) {
        selection.addRange(range);
      }
    }
    if (
      inputSelection !== null &&
      inputSelection.start !== null &&
      inputSelection.end !== null &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    ) {
      active.setSelectionRange(
        inputSelection.start,
        inputSelection.end,
        inputSelection.direction ?? undefined
      );
    }
  }
}
