/**
 * @author Codex
 * @description Derives final recorded choice requirements without allowing model prose or omitted references to remove them.
 */
import type { BrowserSkillChoice } from '@octopus/shared/protocol/browser-skills';
import type { RecordingEvidence } from './recording-evidence';
import type { RecordedEvent } from './recording-contract';

export type ChoiceDecisions = Record<string, { omit: true } | { state: boolean | string[] }>;

/**
 * Applies only explicit session decisions to a copy; saved files and the immutable source snapshot are untouched.
 */
export function applyChoiceDecisions(
  choices: BrowserSkillChoice[],
  decisions: ChoiceDecisions = {}
): BrowserSkillChoice[] {
  return choices.flatMap((original) => {
    const choice = structuredClone(original);
    const decision = decisions[choice.id];
    if (decision && 'omit' in decision) {
      return [];
    }
    if (decision && 'state' in decision) {
      choice.control.state = structuredClone(decision.state);
    }
    return [choice];
  });
}

/**
 * Detects missing source facts without inventing values or silently upgrading an existing recording.
 */
export function requiresNewControlCapture(
  event: Pick<RecordedEvent, 'action' | 'role' | 'inputType' | 'control'>
): boolean {
  return (
    (event.role === 'input' && !event.inputType) ||
    (!event.control &&
      (event.action === 'select' || ['radio', 'checkbox', 'switch'].includes(event.role ?? '')))
  );
}

/**
 * Refuses to flatten conflicting choice phases separated by a click/submit into one final requirement.
 * This is an explicit unsupported case until phase semantics are represented, not an inferred task rewrite.
 */
export function hasConflictingChoicePhases(evidence: RecordingEvidence): boolean {
  const seen = new Map<string, { index: number; value: string }>();
  return evidence.actions.some((action, index) => {
    const control = action.control;
    if (!control || control.state === null) {
      return false;
    }
    const key = JSON.stringify([
      action.tabRef,
      action.url,
      control.role,
      control.group,
      control.role === 'radio' && control.group ? '' : control.label,
    ]);
    const value = JSON.stringify([control.label, control.state]);
    const prior = seen.get(key);
    seen.set(key, { index, value });
    return Boolean(
      prior &&
      prior.value !== value &&
      evidence.actions
        .slice(prior.index + 1, index)
        .some(
          (between) =>
            !between.control && ['click', 'manual', 'navigate', 'tab_close'].includes(between.action)
        )
    );
  });
}

/**
 * Keeps the latest observation per page/group/control; different groups and checkbox options stay independent.
 */
export function recordingChoices(
  evidence: RecordingEvidence | undefined,
  decisions: ChoiceDecisions = {}
): BrowserSkillChoice[] {
  const choices = new Map<string, BrowserSkillChoice>();
  for (const action of evidence?.actions ?? []) {
    const control = action.control;
    if (!control) {
      continue;
    }
    const key = JSON.stringify([
      action.tabRef,
      action.url,
      control.role,
      control.group,
      control.role === 'radio' && control.group ? '' : control.label,
    ]);
    choices.set(key, {
      id: `choice-${action.id}`,
      ref: action.id,
      url: action.url,
      control: structuredClone(control),
    });
  }
  return applyChoiceDecisions([...choices.values()], decisions);
}
