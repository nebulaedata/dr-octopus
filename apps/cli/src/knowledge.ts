/**
 * @author Codex
 * @description Forward knowledge lifecycle through the public Agent subpath without loading native stores in the product CLI.
 */
import { ensureDependencies } from './dependencies.js';
import { dataDirectory, releasePaths } from './paths.js';
import { execute } from './process.js';
import type { DependencyOptions } from './dependencies.js';

/**
 * Pass all dynamic values as process arguments, preserving paths and explicit stop semantics.
 */
export async function knowledgeAction(
  action: string,
  agentDir?: string,
  options: DependencyOptions = {}
): Promise<unknown> {
  const methods: Record<string, string> = {
    start: 'startKnowledgeService',
    stop: 'stopKnowledgeService',
    restart: 'restartKnowledgeService',
    status: 'getKnowledgeServiceStatus',
    health: 'checkKnowledgeServiceHealth',
  };
  const method = methods[action];
  if (!method) {
    throw new Error('Unknown knowledge action');
  }
  if (action === 'start' || action === 'restart') {
    await ensureDependencies(options);
  }
  const directory = dataDirectory(agentDir ?? process.env['DR_OCTOPUS_CODING_AGENT_DIR'], 'agent');
  const output = await execute(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const sdk = await import('@octopus/agent'); const result = await sdk[process.argv[1]](process.argv[2]); console.log('OCTOPUS_RESULT=' + JSON.stringify(result));",
      method,
      directory,
    ],
    releasePaths().cli
  );
  const line = output
    .split(/\r?\n/u)
    .reverse()
    .find((value) => value.startsWith('OCTOPUS_RESULT='));
  if (!line) {
    throw new Error('Knowledge service returned no result');
  }
  return JSON.parse(line.slice('OCTOPUS_RESULT='.length)) as unknown;
}
