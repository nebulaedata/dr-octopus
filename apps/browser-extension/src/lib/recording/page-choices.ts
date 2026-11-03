/**
 * @author Codex
 * @description Resolves finite choice requirements from current DOM semantics; never parses model text or PageController indices to authorize a target.
 */
import type { BrowserSkillChoice } from '@octopus/shared/protocol/browser-skills';
import { readChoiceControl } from './control-semantics';
import { safeRecordingUrl, safeRecordingText } from './recording-privacy';

export const choiceSelector =
  'input[type="radio"],input[type="checkbox"],select,[role="radio"],[role="checkbox"],[role="switch"]';

/**
 * Compares observed state by value; multi-select ordering does not change the selection meaning.
 */
export function sameChoiceState(left: unknown, right: unknown): boolean {
  if (left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  }
  return left === right;
}

/**
 * Limits a recorded requirement to its recorded route; query/fragment values are never used as identity.
 */
export function choiceOnPage(choice: BrowserSkillChoice, url: string): boolean {
  return choice.url === safeRecordingUrl(url);
}

/**
 * Requires an unambiguous label/group/role and a usable control; absence never becomes false/unchecked.
 */
export function locateChoice(choice: BrowserSkillChoice, scopes: (Document | ShadowRoot)[]) {
  if (!choiceOnPage(choice, location.href)) {
    return { status: 'wrong_page' as const };
  }
  const matches: { element: Element; state: unknown }[] = [];
  for (const scope of scopes) {
    const elements = scope.querySelectorAll(choiceSelector);
    if (elements.length > 1000) {
      return { status: 'unsupported' as const };
    }
    for (const element of elements) {
      const control = readChoiceControl(element);
      if (
        control &&
        control.role === choice.control.role &&
        control.group === choice.control.group &&
        control.label === choice.control.label
      ) {
        matches.push({ element, state: control.state });
      }
    }
  }
  if (matches.length === 0) {
    return { status: 'unavailable' as const };
  }
  if (matches.length !== 1) {
    return { status: 'ambiguous' as const };
  }
  const { element, state } = matches[0]!;
  let activation = element;
  if (element instanceof HTMLInputElement) {
    const label = [...(element.labels ?? [])].find(
      (item) =>
        item.control === element &&
        item.getClientRects().length &&
        getComputedStyle(item).display !== 'none' &&
        getComputedStyle(item).visibility !== 'hidden'
    );
    if (label) {
      activation = label;
    }
  }
  if (element instanceof HTMLSelectElement && Array.isArray(choice.control.state)) {
    for (const desired of choice.control.state) {
      const options = [...element.options].filter((option) => safeRecordingText(option.label) === desired);
      if (!options.length || options[0]?.disabled) {
        return { status: 'unavailable' as const };
      }
      if (options.length !== 1) {
        return { status: 'ambiguous' as const };
      }
    }
  }
  if (
    choice.control.state === null ||
    state === null ||
    !element.isConnected ||
    element.matches(':disabled,[aria-disabled="true"]') ||
    !activation.getClientRects().length
  ) {
    return { status: 'unknown' as const };
  }
  return {
    status: 'resolved' as const,
    element,
    activation,
    satisfied: sameChoiceState(state, choice.control.state),
  };
}

/**
 * Removes direct choice targets and their labels from ordinary indexed actions while keeping other controls usable.
 */
export function protectedChoiceElements(scopes: (Document | ShadowRoot)[]): Element[] {
  const blocked = new Set<Element>();
  for (const scope of scopes) {
    for (const element of scope.querySelectorAll(choiceSelector)) {
      blocked.add(element);
      for (const child of element.querySelectorAll('*')) {
        blocked.add(child);
      }
      const group = element.closest('fieldset,[role="radiogroup"],[role="group"]');
      if (group) {
        blocked.add(group);
      }
      const labels =
        element instanceof HTMLInputElement || element instanceof HTMLSelectElement
          ? [...(element.labels ?? [])]
          : [];
      for (const label of labels) {
        blocked.add(label);
        for (const child of label.querySelectorAll('*')) {
          blocked.add(child);
        }
      }
    }
  }
  return [...blocked];
}
