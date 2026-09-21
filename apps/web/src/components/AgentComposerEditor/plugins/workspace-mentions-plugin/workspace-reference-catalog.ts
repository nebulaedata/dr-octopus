/**
 * @author Codex
 * @description Selects and orders Workspace references so keyboard navigation matches grouped menu presentation.
 */

import type { ComposerReference } from '@/components/AgentComposerEditor/types';

/**
 * Selects the best matching references, then places files before folders to match the menu's visual groups.
 *
 * @param references - Complete Workspace reference catalog.
 * @param query - Current Lexical mention query without the leading at sign.
 * @param limit - Maximum number of references exposed to the typeahead menu.
 * @returns References in the exact order used by both Lexical navigation and menu rendering.
 */
export function buildWorkspaceReferenceCatalog(
  references: ComposerReference[],
  query: string | null,
  limit: number
): ComposerReference[] {
  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? '';
  return references
    .filter((reference) => {
      if (normalizedQuery === '') {
        return true;
      }
      return (
        reference.path.toLocaleLowerCase().includes(normalizedQuery) ||
        reference.label.toLocaleLowerCase().includes(normalizedQuery)
      );
    })
    .toSorted((left, right) => {
      const leftPrefix = left.path.toLocaleLowerCase().startsWith(normalizedQuery);
      const rightPrefix = right.path.toLocaleLowerCase().startsWith(normalizedQuery);
      return Number(rightPrefix) - Number(leftPrefix) || left.path.localeCompare(right.path);
    })
    .slice(0, limit)
    .toSorted((left, right) => Number(left.kind === 'directory') - Number(right.kind === 'directory'));
}
