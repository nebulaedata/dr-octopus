/**
 * @author Codex
 * @description Preserves public terminal helpers without loading terminal UI from the Agent package barrel.
 */
import { isInteractiveTuiLaunch } from './launch-mode.js';
import type { TerminalCapabilities } from './launch-mode.js';
import type { InteractiveInstallOptions } from './terminal-ui.js';

/**
 * Loads the renderer only when a real interactive Agent launch will display its logo.
 */
export async function renderStartupLogo(args: readonly string[]): Promise<boolean> {
  if (!isInteractiveTuiLaunch(args)) {
    return false;
  }
  return (await import('./terminal-ui.js')).renderStartupLogo(args);
}

/**
 * Executes silent or redirected installs directly and imports terminal prompts only for a TTY.
 */
export async function runInteractiveInstall<T>(
  install: () => Promise<T>,
  options: InteractiveInstallOptions = {},
  terminal: TerminalCapabilities = {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
  }
): Promise<T | undefined> {
  if (options.silent || !terminal.stdinIsTTY || !terminal.stdoutIsTTY) {
    return install();
  }
  return (await import('./terminal-ui.js')).runInteractiveInstall(install, options, terminal);
}
