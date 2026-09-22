/**
 * @author Codex
 * @description Prefetches Host model metadata for home routes without starting Agent processes.
 */
import { getConversationModels } from '@/api/conversation-starts';
import { getWorkspaces } from '@/api/workspace';
import { queryKeys } from '@/queries/query-keys';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Prefetches the shared model directory without allocating a Session.
 *
 * @param queryClient Shared application query cache.
 * @param workspaceId Workspace selected by the matched route.
 */
export function prewarmWorkspaceHome(queryClient: QueryClient, workspaceId: string): void {
  void workspaceId;
  void queryClient.prefetchQuery({
    queryKey: ['conversation-models'],
    queryFn: ({ signal }) => getConversationModels(signal),
    staleTime: 0,
    retry: false,
  });
}

/**
 * Resolves the general Workspace and warms only the Host model query.
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
