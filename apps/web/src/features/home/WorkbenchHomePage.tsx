/**
 * @author Codex
 * @description Opens the general workspace agent home without registering an empty Session.
 */
import { useWorkspaces } from '@/queries/workbench-queries';
import { useI18n } from '@/i18n/use-i18n';
import { AgentHomePage } from '@/features/home/AgentHomePage';

/**
 * Resolves the general workspace independently of catalog ordering.
 */
export function WorkbenchHomePage() {
  const { t } = useI18n();
  const workspaces = useWorkspaces();
  const workspaceId = workspaces.data?.find((workspace) => workspace.kind === 'general')?.id;
  if (workspaceId === undefined) {
    return (
      <p role="status" className="p-8 text-sm text-muted-foreground">
        {workspaces.error?.message ?? t('home.loadingWorkspaces', 'Loading workspaces…')}
      </p>
    );
  }
  return <AgentHomePage workspaceId={workspaceId} />;
}
