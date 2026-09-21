/**
 * @author Codex
 * @description Dispatch explicit scheduler lifecycle commands before Workspace, onboarding or model setup.
 */
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
  getSchedulerServiceStatus,
  restartSchedulerService,
  startSchedulerService,
  stopSchedulerService,
} from '../extensions/scheduler/sdk/lifecycle.js';

/**
 * Execute a service subcommand with optional explicit Agent data directory.
 */
export async function runSchedulerCli(args: string[]): Promise<void> {
  const [command, option, directory, ...extra] = args;
  if (
    !['start', 'status', 'stop', 'restart'].includes(command ?? '') ||
    extra.length > 0 ||
    (option !== undefined && (option !== '--agent-dir' || !directory))
  ) {
    throw new Error('Usage: octopus scheduler service start|status|stop|restart [--agent-dir <path>]');
  }
  const agentDir = directory ?? getAgentDir();
  const operation =
    command === 'start'
      ? startSchedulerService
      : command === 'stop'
        ? stopSchedulerService
        : command === 'restart'
          ? restartSchedulerService
          : getSchedulerServiceStatus;
  process.stdout.write(JSON.stringify(await operation(agentDir)) + '\n');
}
