/**
 * @author Codex
 * @description Adapts the Agent's public Scheduler lifecycle SDK through an isolated, lazily loaded process.
 */
import { ensureDependencies, verifyDependencies } from './dependencies.js';
import { dataDirectory, releasePaths } from './paths.js';
import { execute } from './process.js';
import type { DependencyOptions } from './dependencies.js';

/**
 * Preserves Scheduler-specific state and persistent stop semantics without loading it in the CLI.
 */
export async function schedulerAction(
  action: string,
  agentDir?: string,
  options: DependencyOptions = {}
): Promise<unknown> {
  if (action === 'start' || action === 'restart') {
    await ensureDependencies(options);
  } else {
    await verifyDependencies();
  }
  const methods: Record<string, string> = {
    start: 'startSchedulerService',
    stop: 'stopSchedulerService',
    restart: 'restartSchedulerService',
    status: 'getSchedulerServiceStatus',
  };
  const method = methods[action];
  if (!method) {
    throw new Error('Unknown Scheduler action');
  }
  const directory = dataDirectory(agentDir ?? process.env['DR_OCTOPUS_CODING_AGENT_DIR'], 'agent');
  const output = await execute(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    const sdk = await import('@octopus/agent');
    const result = await sdk[${JSON.stringify(method)}](${JSON.stringify(directory)});
    console.log('OCTOPUS_RESULT=' + JSON.stringify(result));
  `,
    ],
    releasePaths().cli
  );
  const line = output
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith('OCTOPUS_RESULT='));
  if (!line) {
    throw new Error('Scheduler returned no result');
  }
  return JSON.parse(line.slice('OCTOPUS_RESULT='.length)) as unknown;
}
