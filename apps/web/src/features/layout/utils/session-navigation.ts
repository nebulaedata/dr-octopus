/**
 * @author Codex
 * @description Resolves cyclic Session navigation in the current workspace's Sidebar order.
 */

/**
 * Selects a sibling, wrapping at either end of the supplied Sidebar order.
 *
 * @param sessions Sessions in display order for the selected workspace.
 * @param currentSessionId Active route Session; absent or stale IDs enter from an end.
 * @param direction Previous (-1) enters at the last Session; next (1) enters at the first.
 * @returns The destination Session, or undefined when the workspace has no Sessions.
 */
export function getSiblingSession<T extends { id: string }>(
  sessions: readonly T[],
  currentSessionId: string | undefined,
  direction: -1 | 1
): T | undefined {
  if (sessions.length === 0) {
    return undefined;
  }
  const currentIndex = sessions.findIndex((session) => session.id === currentSessionId);
  if (currentIndex === -1) {
    return direction === 1 ? sessions[0] : sessions[sessions.length - 1];
  }
  return sessions[(currentIndex + direction + sessions.length) % sessions.length];
}
