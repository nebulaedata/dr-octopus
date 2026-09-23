/**
 * @author Codex
 * @description Validates pi-plan-mode 0.55.3 Session entries and projects its active workflow state.
 */

import type { PlanModeStateDto } from '@octopus/shared/protocol';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

const PLAN_MODE_STATE_ENTRY_TYPE = 'plan-mode-state';
const MAX_PLAN_CHARACTERS = 50_000;

/**
 * Projects the latest canonical pi-plan-mode state from the current Session branch.
 *
 * @param entries Current branch entries returned by Pi SessionManager.
 * @param available Whether the runtime command catalog exposes the pinned Plan extension.
 * @returns Browser-safe Plan mode state.
 */
export function projectPlanModeState(entries: readonly SessionEntry[], available: boolean): PlanModeStateDto {
  if (!available) {
    return { available: false, workMode: 'agent', phase: 'off', awaitingAction: false };
  }
  const data = findLatestPlanModeData(entries);
  if (data?.['enabled'] === true) {
    const ready = readPlan(data['latestPlan']) !== undefined;
    return {
      available,
      workMode: 'plan',
      phase: ready ? 'ready' : 'planning',
      awaitingAction: ready && data['awaitingAction'] === true,
    };
  }
  if (isStoredPlan(data?.['activeImplementation'])) {
    return { available, workMode: 'agent', phase: 'implementing', awaitingAction: false };
  }
  if (isStoredPlan(data?.['savedPlan'])) {
    return { available, workMode: 'agent', phase: 'saved', awaitingAction: false };
  }
  return { available, workMode: 'agent', phase: 'off', awaitingAction: false };
}

/**
 * Detects the Plan command in a projected Pi command catalog.
 *
 * @param commands Untrusted command records returned by Pi RPC.
 * @returns Whether the exact extension command is available.
 */
export function hasPlanModeCommand(commands: readonly unknown[]): boolean {
  return commands.some((value) => {
    const command = isRecord(value) ? value : undefined;
    return command?.['name'] === 'plan' && command['source'] === 'extension';
  });
}

/**
 * Finds the newest entry owned by pi-plan-mode without accepting message-shaped lookalikes.
 *
 * @param entries Current Session branch.
 * @returns The persisted data object when structurally valid.
 */
function findLatestPlanModeData(entries: readonly SessionEntry[]): Record<string, unknown> | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === 'custom' && entry.customType === PLAN_MODE_STATE_ENTRY_TYPE) {
      return isRecord(entry.data) ? entry.data : undefined;
    }
  }
  return undefined;
}

/**
 * Validates the bounded Markdown payload retained by ready, saved, and implementation states.
 *
 * @param value Candidate plan text.
 * @returns Trimmed plan when usable.
 */
function readPlan(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const plan = value.trim();
  return plan.length > 0 && plan.length <= MAX_PLAN_CHARACTERS ? plan : undefined;
}

/**
 * Validates only the public plan-bearing portion of a saved or active implementation record.
 *
 * @param value Candidate nested state.
 * @returns Whether it carries one bounded plan.
 */
function isStoredPlan(value: unknown): boolean {
  return isRecord(value) && readPlan(value['plan']) !== undefined;
}

/**
 * Narrows unknown values to non-array records.
 *
 * @param value Candidate value.
 * @returns Whether named properties may be read safely.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
