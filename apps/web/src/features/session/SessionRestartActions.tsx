/**
 * @author Codex
 * @description Supplies session restart actions and their owned confirmation dialog to external views.
 */
import { useRestartSession } from './hooks/use-restart-session';
import { RestartSessionDialog } from './RestartSessionDialog';
import type { ReactNode } from 'react';
import type { SessionDto } from '@octopus/shared/protocol';
export interface SessionRestartActionsProps {
  /**
   * Renders actions and the dialog at the consumer's existing visual positions.
   */
  children(
    actions: { start: (session: SessionDto, whenIdle?: boolean) => void; pending: string[] },
    dialog: ReactNode
  ): ReactNode;
}
/**
 * Keeps confirmation state local while Query continues to share pending mutation identities.
 */
export function SessionRestartActions({ children }: SessionRestartActionsProps) {
  const action = useRestartSession();
  return children({ start: action.start, pending: action.pending }, <RestartSessionDialog action={action} />);
}
