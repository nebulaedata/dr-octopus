/**
 * @author Codex
 * @description Identifies interactive CLI launches without importing terminal rendering or installation UI.
 */
import { parseArgs } from '@earendil-works/pi-coding-agent';

const NON_AGENT_COMMANDS = new Set(['auth', 'config', 'install', 'list', 'remove', 'uninstall', 'update']);

export interface TerminalCapabilities {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
}

/**
 * Mirrors Pi's mode selection while keeping headless startup free of Octopus terminal UI imports.
 */
export function isInteractiveTuiLaunch(
  args: readonly string[],
  terminal: TerminalCapabilities = {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
  }
): boolean {
  if (!terminal.stdinIsTTY || !terminal.stdoutIsTTY) {
    return false;
  }
  if (args[0] !== undefined && NON_AGENT_COMMANDS.has(args[0])) {
    return false;
  }
  const parsed = parseArgs([...args]);
  return (
    !parsed.diagnostics.some((diagnostic) => diagnostic.type === 'error') &&
    parsed.help !== true &&
    parsed.version !== true &&
    parsed.export === undefined &&
    parsed.listModels === undefined &&
    parsed.print !== true &&
    parsed.mode !== 'json' &&
    parsed.mode !== 'rpc'
  );
}
