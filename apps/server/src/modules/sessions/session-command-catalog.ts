/**
 * @author Codex
 * @description Defines the Web-supported Host command registry and merges it with Pi prompt commands.
 */

import type { CommandCatalogDto, CommandDto } from '@octopus/shared/protocol';

interface RuntimeCommand {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
}

const HOST_COMMANDS: readonly CommandDto[] = [
  {
    name: 'compact',
    description: 'Compact the current session context',
    source: 'host',
    execution: 'realtime',
    enabled: true,
  },
  {
    name: 'model',
    description: 'Select the active model',
    source: 'host',
    execution: 'client',
    enabled: true,
  },
  {
    name: 'new',
    description: 'Create a new session',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'fork',
    description: 'Fork the current conversation',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'clone',
    description: 'Clone the current session',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'name',
    description: 'Rename the current session',
    source: 'host',
    execution: 'client',
    enabled: true,
  },
  {
    name: 'export',
    description: 'Export the current session as HTML',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'settings',
    description: 'Open Web settings',
    source: 'host',
    execution: 'client',
    enabled: true,
  },
  {
    // TODO: Enable when the Web keyboard-shortcuts dialog is implemented.
    name: 'hotkeys',
    description: 'Show Web keyboard shortcuts (coming soon)',
    source: 'host',
    execution: 'client',
    enabled: false,
    disabledReason: 'The Web hotkeys guide is not available yet.',
  },
];

/**
 * Combines Host-owned commands with Pi commands while reserving names for supported Web behavior.
 *
 * @param runtimeCommands Commands returned by Pi RPC get_commands.
 * @returns Stable browser command catalog with one owner per invocation name.
 */
export function createSessionCommandCatalog(runtimeCommands: readonly RuntimeCommand[]): CommandCatalogDto {
  const commands = HOST_COMMANDS.map((command) => ({ ...command }));
  const reservedNames = new Set(commands.map((command) => command.name));
  for (const command of runtimeCommands) {
    if (reservedNames.has(command.name)) {
      continue;
    }
    reservedNames.add(command.name);
    commands.push({
      name: command.name,
      ...(command.description === undefined ? {} : { description: command.description }),
      source: command.source,
      execution: 'prompt',
      enabled: true,
    });
  }
  return { commands };
}
