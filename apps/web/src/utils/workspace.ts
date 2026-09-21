/**
 * @author Claude Code
 * @description Resolves workspace display names, localizing the built-in General workspace at render time.
 */

import type { Translate } from '@/i18n/use-i18n';
import type { WorkspaceDto } from '@octopus/shared/protocol';

/**
 * Returns the name to show for a workspace: the built-in General workspace follows the active
 * locale, while user-created project workspaces keep their stored names.
 *
 * @param t - Active translation function from `useI18n`.
 * @param workspace - Workspace (or its kind/name subset) to present.
 * @returns Localized display name for the workspace.
 */
export function workspaceDisplayName(t: Translate, workspace: Pick<WorkspaceDto, 'kind' | 'name'>): string {
  return workspace.kind === 'general' ? t('workspaces.generalName', 'General') : workspace.name;
}
