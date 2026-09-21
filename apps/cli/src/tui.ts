/**
 * @author Codex
 * @description Launches the Agent's public octopus binary with ownership of the caller's terminal.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { join } from 'node:path';
import { ensureDependencies } from './dependencies.js';
import { releasePaths } from './paths.js';
import { insidePath } from './distribution/config.js';
import type { DependencyOptions } from './dependencies.js';

/**
 * Resolves the declared public binary from the runtime CLI's direct Agent dependency.
 * This honors relocated packages and bin paths without loading Agent code in the bootstrap.
 */
export async function resolveAgentBinary(cliDirectory: string): Promise<string> {
  const directory = join(cliDirectory, 'node_modules', '@octopus', 'agent');
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
    bin?: { octopus?: string };
  };
  const entry = manifest.bin?.octopus;
  if (!entry) {
    throw new Error('The installed Agent package does not declare an octopus binary.');
  }
  return insidePath(directory, entry.replace(/^\.\//, ''));
}

/**
 * Runs without a shell or timeout, inheriting stdin, output, environment and working directory.
 * Forwards termination signals and returns the child's exit status without a result envelope.
 */
export async function runAgentTerminal(entry: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit' });
    /**
     * Relays externally requested interruption to the foreground Agent.
     */
    const interrupt = () => child.kill('SIGINT');
    /**
     * Relays host shutdown to the foreground Agent.
     */
    const terminate = () => child.kill('SIGTERM');
    /**
     * Releases process listeners after either launch failure or child termination.
     */
    const cleanup = () => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 128 + constants.signals[signal] : 1));
    });
  });
}

/**
 * Applies the existing installation policy before handing the terminal to octopus's default TUI.
 */
export async function startTui(args: string[], options: DependencyOptions): Promise<number> {
  await ensureDependencies(options);
  return runAgentTerminal(await resolveAgentBinary(releasePaths().cli), args);
}
