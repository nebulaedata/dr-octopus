/**
 * @author Codex
 * @description Starts unpublished Session preparation from empty-home route loaders without delaying route rendering.
 */
import { prepareSessionDraft } from '@/api/sessions';
import { getWorkspaces } from '@/api/workspace';
import { queryKeys } from '@/queries/query-keys';
import { useWorkbenchHome } from '@/stores/workbench-home';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Starts or reuses preparation for one Workspace home draft.
 *
 * @param queryClient Shared application query cache.
 * @param workspaceId Workspace selected by the matched route.
 */
export function prewarmWorkspaceHome(queryClient: QueryClient, workspaceId: string): void {
  const draftId = useWorkbenchHome.getState().ensureDraftId(workspaceId);
  void queryClient.prefetchQuery({
    queryKey: queryKeys.sessionDraft(workspaceId, draftId),
    queryFn: () => prepareSessionDraft(workspaceId, draftId),
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Resolves the general Workspace and starts its home draft preparation.
 *
 * @param queryClient Shared application query cache.
 */
export function prewarmGeneralHome(queryClient: QueryClient): void {
  void queryClient
    .fetchQuery({
      queryKey: queryKeys.workspaces,
      queryFn: ({ signal }) => getWorkspaces(signal),
    })
    .then((workspaces) => {
      const workspaceId = workspaces.find((workspace) => workspace.kind === 'general')?.id;
      if (workspaceId !== undefined) {
        prewarmWorkspaceHome(queryClient, workspaceId);
      }
    })
    .catch(() => {
      // The page-level query owns visible error reporting and retry behavior.
    });
}
