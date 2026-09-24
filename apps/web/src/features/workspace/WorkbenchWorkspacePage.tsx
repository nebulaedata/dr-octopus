/**
 * @author Codex
 * @description Opens a workspace-scoped agent home with an unpublished warmed conversation.
 */
import { useParams } from '@tanstack/react-router';
import { AgentHomePage } from '@/features/home';

/**
 * Scopes the same first-message flow to the selected workspace.
 */
export function WorkbenchWorkspacePage() {
  const { workspaceId } = useParams({ strict: false }) as { workspaceId: string };
  return <AgentHomePage workspaceId={workspaceId} />;
}
