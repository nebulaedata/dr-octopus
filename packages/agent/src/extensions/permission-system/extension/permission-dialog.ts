/**
 * @author Codex
 * @description Presents the four-way permission decision flow through Pi's RPC-compatible UI surface.
 */

import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';

export type PermissionPromptDecision =
  | { state: 'approved'; approved: true }
  | { state: 'approved_for_session'; approved: true }
  | { state: 'denied'; approved: false }
  | { state: 'denied_with_reason'; approved: false; denialReason: string };

const APPROVE_OPTION = 'Yes';
const APPROVE_FOR_SESSION_OPTION = 'Yes, for this session';
const DENY_OPTION = 'No';
const DENY_WITH_REASON_OPTION = 'No, provide reason';

/**
 * Requests the same four decisions exposed by the original permission package.
 *
 * @param ui Pi UI bridge shared by TUI and RPC sessions.
 * @param title Permission prompt title.
 * @param detail Human-readable operation preview.
 * @param sessionLabel Optional precise scope shown for the session grant.
 * @returns The selected approval or denial, treating cancellation as denial.
 */
export async function requestPermissionDecision(
  ui: Pick<ExtensionUIContext, 'select' | 'input'>,
  title: string,
  detail: string,
  sessionLabel?: string | null
): Promise<PermissionPromptDecision> {
  const sessionOption = sessionLabel ?? APPROVE_FOR_SESSION_OPTION;
  const selected = await ui.select(`${title}\n${detail}`, [
    APPROVE_OPTION,
    ...(sessionLabel === null ? [] : [sessionOption]),
    DENY_OPTION,
    DENY_WITH_REASON_OPTION,
  ]);

  if (selected === APPROVE_OPTION) {
    return { approved: true, state: 'approved' };
  }
  if (sessionLabel !== null && selected === sessionOption) {
    return { approved: true, state: 'approved_for_session' };
  }
  if (selected === DENY_WITH_REASON_OPTION) {
    const denialReason = (
      await ui.input(
        `${title}\nShare why this request was denied (optional).`,
        'Reason shown back to the agent'
      )
    )?.trim();
    if (denialReason) {
      return { approved: false, state: 'denied_with_reason', denialReason };
    }
  }
  return { approved: false, state: 'denied' };
}
