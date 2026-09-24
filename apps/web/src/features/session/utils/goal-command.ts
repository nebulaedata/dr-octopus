/**
 * @author Codex
 * @description Builds Host realtime commands for explicit pi-goal user management actions.
 */

import type { ClientRealtimeMessage } from '@octopus/shared/protocol';

export const GOAL_CLEAR_MESSAGE = '/goal clear';

/**
 * Creates the canonical pi-goal clear command without duplicating extension state transitions in the Host.
 *
 * @param requestId Browser-generated mutation identity.
 * @param sessionId Target Web Session identity.
 * @param runtimeId Expected Pi runtime generation identity.
 * @param epoch Expected Pi runtime generation epoch.
 * @returns Realtime prompt routed through Pi's registered `/goal` command.
 */
export function createGoalClearCommand(
  requestId: string,
  sessionId: string,
  runtimeId: string | undefined,
  epoch: number | undefined
): Extract<ClientRealtimeMessage, { type: 'agent.prompt' }> {
  return {
    type: 'agent.prompt',
    requestId,
    sessionId,
    runtimeId,
    epoch,
    payload: { message: GOAL_CLEAR_MESSAGE },
  };
}
