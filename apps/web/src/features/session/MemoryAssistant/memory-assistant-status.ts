/**
 * @author Codex
 * @description Translates the Session's memory observation into the assistant's spoken label and visual tone.
 */
import type { Translate } from '@/i18n/use-i18n';
import type { MemoryRuntimeSnapshot } from '@octopus/shared/protocol/memory';

export type MemoryAssistantTone = 'active' | 'busy' | 'warning' | 'muted';

export interface MemoryAssistantStatus {
  /** Short phrase shown inside the assistant's speech bubble. */
  label: string;
  /** Drives bubble colors so working and degraded states read at a glance. */
  tone: MemoryAssistantTone;
  /** True while the curator is actively organizing memories. */
  busy: boolean;
}

/**
 * Hides absent state behind a friendly standby label and mirrors the previous status wording exactly.
 *
 * @param t - Active translation function from `useI18n`.
 * @param state Latest validated memory observation; undefined before the runtime reports one.
 * @returns The bubble copy and tone for the assistant.
 */
export function describeMemoryAssistantState(
  t: Translate,
  state: MemoryRuntimeSnapshot | undefined
): MemoryAssistantStatus {
  if (!state) {
    return { label: t('memory.assistant.standby', 'Memory assistant'), tone: 'muted', busy: false };
  }
  if (state.availability === 'unavailable') {
    return { label: t('memory.assistant.unavailable', 'Memory unavailable'), tone: 'warning', busy: false };
  }
  if (state.curator === 'running') {
    return { label: t('memory.assistant.organizing', 'Organizing memories'), tone: 'busy', busy: true };
  }
  if (state.curator === 'failed') {
    return {
      label: t('memory.assistant.organizeFailed', 'Memory organization incomplete'),
      tone: 'warning',
      busy: false,
    };
  }
  if (state.mode === 'off') {
    return { label: t('memory.assistant.off', 'Memory off'), tone: 'muted', busy: false };
  }
  if (state.mode === 'manual') {
    return { label: t('memory.assistant.manual', 'Manual memory'), tone: 'active', busy: false };
  }
  return { label: t('memory.assistant.auto', 'Auto memory'), tone: 'active', busy: false };
}
