/**
 * @author Codex
 * @description Reads bounded control labels and choice state for recording and local replay without collecting editable values.
 */
import type { BrowserChoiceControl } from '@octopus/shared/protocol/browser-skills';
import { safeRecordingText } from './recording-privacy';

const sensitiveSelector =
  '[type="password"],[autocomplete="one-time-code"],[data-sensitive],[data-page-agent-sensitive],[data-executor-sensitive]';

/**
 * Treats an explicitly protected associated label as protecting its control as well.
 */
export function sensitiveControl(element: Element): boolean {
  if (element.closest(sensitiveSelector)) {
    return true;
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if ([...(element.labels ?? [])].some((label) => label.closest(sensitiveSelector))) {
      return true;
    }
  }
  const root = element.getRootNode() as Document | ShadowRoot;
  return (element.getAttribute('aria-labelledby')?.split(/\s+/).slice(0, 8) ?? []).some((id) =>
    Boolean(root.getElementById?.(id)?.closest(sensitiveSelector))
  );
}

/**
 * Reads label text while excluding embedded fields, option lists and explicitly sensitive subtrees.
 */
export function readLabelText(element: Element): string {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let size = 0;
  let count = 0;
  while (walker.nextNode() && count++ < 1000 && size < 2048) {
    const node = walker.currentNode;
    if (
      node.parentElement?.closest(
        'input,select,textarea,script,style,[contenteditable],[data-sensitive],[data-page-agent-sensitive],[data-executor-sensitive]'
      )
    ) {
      continue;
    }
    const text = node.textContent?.trim();
    if (text) {
      parts.push(text);
      size += text.length;
    }
  }
  return parts.join(' ');
}

/**
 * Resolves explicit accessible labels within the element's own document or shadow root.
 */
function labelled(element: Element): string {
  const direct = element.getAttribute('aria-label');
  if (direct) {
    return direct;
  }
  const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).slice(0, 8) ?? [];
  const root = element.getRootNode() as Document | ShadowRoot;
  return ids
    .map((id) => {
      const label = root.getElementById?.(id);
      if (label?.closest('[data-sensitive],[data-page-agent-sensitive],[data-executor-sensitive]')) {
        return '';
      }
      return label ? readLabelText(label) : '';
    })
    .join(' ')
    .trim();
}

/**
 * Keeps associated explanatory text intact unless the page explicitly distinguishes the accessible name.
 */
export function controlLabel(element: Element): string {
  let name = labelled(element);
  if (
    !name &&
    (element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement)
  ) {
    const label = element.labels?.[0];
    if (!label?.closest('[data-sensitive],[data-page-agent-sensitive],[data-executor-sensitive]')) {
      name = label ? readLabelText(label) : '';
    }
  }
  if (!name && element.matches('[role="radio"], [role="checkbox"], [role="switch"]')) {
    name = readLabelText(element);
  }
  return safeRecordingText(name);
}

/**
 * Returns undefined for editable inputs; unknown state is explicit and never inferred from label text.
 */
export function readChoiceControl(element: Element): BrowserChoiceControl | undefined {
  if (sensitiveControl(element)) {
    return;
  }
  let role: BrowserChoiceControl['role'];
  if (element instanceof HTMLSelectElement) {
    role = 'select';
  } else if (element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type)) {
    role = element.type as 'radio' | 'checkbox';
  } else if (['radio', 'checkbox', 'switch'].includes(element.getAttribute('role') ?? '')) {
    role = element.getAttribute('role') as BrowserChoiceControl['role'];
  } else {
    return;
  }
  const label = controlLabel(element) || '未命名选择控件';
  const container = element.closest('fieldset, [role="radiogroup"], [role="group"]');
  let group = container ? labelled(container) : '';
  if (!group && container?.tagName === 'FIELDSET') {
    const legend = container.querySelector(':scope > legend');
    group = legend ? readLabelText(legend) : '';
  }
  if (!group && element instanceof HTMLInputElement && role === 'radio') {
    group = element.name;
  }
  let state: BrowserChoiceControl['state'] = null;
  if (element instanceof HTMLSelectElement) {
    if (element.selectedOptions.length <= 20) {
      state = [...element.selectedOptions].map((option) => safeRecordingText(option.label)).filter(Boolean);
    }
  } else if (element instanceof HTMLInputElement) {
    state = element.indeterminate ? null : element.checked;
  } else {
    const checked = element.getAttribute('aria-checked');
    if (checked === 'true' || checked === 'false') {
      state = checked === 'true';
    }
  }
  const normalizedGroup = group.replace(/\s+/g, ' ').trim();
  const safeGroup = safeRecordingText(group);
  // Redaction/truncation must not merge unrelated groups into the same invented identity.
  return { role, group: safeGroup === normalizedGroup ? safeGroup : '', label, state };
}
