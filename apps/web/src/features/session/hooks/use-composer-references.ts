/**
 * @author Codex
 * @description Projects the current Workspace file-tree cache into domain-neutral Composer mention options.
 */

import { useEffect } from 'react';
import { useFileExplorerStore } from '@/stores/file-explorer';
import type { ComposerReference } from '@/components/AgentComposerEditor/types';

/**
 * Loads the Workspace root and returns every currently known file and directory in path order.
 */
export function useComposerReferences(workspaceId: string): ComposerReference[] {
  const workspace = useFileExplorerStore((state) => state.workspaces[workspaceId]);

  useEffect(() => {
    void useFileExplorerStore.getState().loadRoot(workspaceId);
  }, [workspaceId]);

  if (workspace === undefined) {
    return [];
  }
  return Object.values(workspace.nodesByPath)
    .map(({ entry }) => ({
      path: entry.path,
      kind: entry.type,
      label: entry.name,
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}
