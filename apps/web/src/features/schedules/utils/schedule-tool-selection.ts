/**
 * @author Codex
 * @description Keeps local catalog filtering independent from persistent cross-search selection.
 */
import type { TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Match every search token against the tool name, description and displayed source.
 */
export function filterTaskTools(tools: TaskToolCatalogEntry[], query: string): TaskToolCatalogEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return tools.filter((tool) => {
    const text = `${tool.name} ${tool.description} ${tool.source ?? ''}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

/**
 * Change only eligible matches, retaining choices outside the current search result.
 */
export function selectTaskToolMatches(
  selected: string[],
  matches: TaskToolCatalogEntry[],
  checked: boolean
): string[] {
  const identities = new Set(matches.filter((tool) => !tool.unavailableReason).map((tool) => tool.identity));
  return checked ? [...new Set([...selected, ...identities])] : selected.filter((id) => !identities.has(id));
}
