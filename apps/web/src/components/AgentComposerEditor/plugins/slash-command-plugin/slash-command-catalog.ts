/**
 * @author Codex
 * @description Builds the complete, locally searchable slash-command catalog shown by the Composer.
 */

import { MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import type { ComposerCommand } from '@/components/AgentComposerEditor/types';

const PREFERRED_SOURCE_ORDER = ['host', 'extension', 'prompt', 'skill'] as const;

export interface SlashCommandGroup {
  source: string;
  totalCount: number;
  commands: ComposerCommand[];
}

export interface SlashCommandCatalog {
  groups: SlashCommandGroup[];
  options: SlashCommandOption[];
  totalCount: number;
  matchedCount: number;
  searching: boolean;
  query: string;
}

export class SlashCommandOption extends MenuOption {
  readonly command: ComposerCommand;

  /**
   * Creates a selectable option for an enabled command.
   *
   * @param command - Enabled command represented by this Lexical option.
   */
  constructor(command: ComposerCommand) {
    super(command.name);
    this.command = command;
  }
}

/**
 * Builds all source groups and ranks matches without truncating any source.
 *
 * @param commands - Complete command catalog supplied by the Session feature.
 * @param query - Current Lexical slash query without the leading slash.
 * @returns Grouped display rows and enabled keyboard-selectable options.
 */
export function buildSlashCommandCatalog(
  commands: ComposerCommand[],
  query: string | null
): SlashCommandCatalog {
  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? '';
  const sources = getOrderedSources(commands);
  const groups = sources.map((source) => {
    const sourceCommands = commands.filter((command) => command.group === source);
    const rankedCommands = sourceCommands
      .map((command, index) => ({ command, index, rank: getMatchRank(command, normalizedQuery) }))
      .filter(
        (entry): entry is { command: ComposerCommand; index: number; rank: number } => entry.rank !== null
      )
      .toSorted((left, right) => left.rank - right.rank || left.index - right.index)
      .map((entry) => entry.command);
    return {
      source,
      totalCount: sourceCommands.length,
      commands: rankedCommands,
    };
  });
  const matchingCommands = groups.flatMap((group) => group.commands);

  return {
    groups,
    options: matchingCommands
      .filter((command) => command.enabled)
      .map((command) => new SlashCommandOption(command)),
    totalCount: commands.length,
    matchedCount: matchingCommands.length,
    searching: normalizedQuery !== '',
    query: query?.trim() ?? '',
  };
}

/**
 * Preserves the established sources first while retaining every future source returned by Pi.
 *
 * @param commands - Complete command catalog.
 * @returns Unique source names in display order.
 */
function getOrderedSources(commands: ComposerCommand[]): string[] {
  const discoveredSources = [...new Set(commands.map((command) => command.group))];
  return [
    ...PREFERRED_SOURCE_ORDER.filter((source) => discoveredSources.includes(source)),
    ...discoveredSources.filter(
      (source) => !PREFERRED_SOURCE_ORDER.includes(source as (typeof PREFERRED_SOURCE_ORDER)[number])
    ),
  ];
}

/**
 * Scores one command using the documented exact, prefix, name, then description priority.
 *
 * @param command - Command being evaluated.
 * @param normalizedQuery - Trimmed lowercase search query.
 * @returns Match priority, or null when the command does not match.
 */
function getMatchRank(command: ComposerCommand, normalizedQuery: string): number | null {
  if (normalizedQuery === '') {
    return 0;
  }
  const name = command.name.toLocaleLowerCase();
  const description = command.description?.toLocaleLowerCase() ?? '';
  if (name === normalizedQuery) {
    return 0;
  }
  if (name.startsWith(normalizedQuery)) {
    return 1;
  }
  if (name.includes(normalizedQuery)) {
    return 2;
  }
  return description.includes(normalizedQuery) ? 3 : null;
}
