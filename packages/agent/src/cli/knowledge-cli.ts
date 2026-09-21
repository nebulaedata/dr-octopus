/**
 * @author Codex
 * @description Knowledge lifecycle dispatch before Workspace bootstrap, Pi onboarding or model setup.
 */
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
  checkKnowledgeServiceHealth,
  getKnowledgeServiceStatus,
  restartKnowledgeService,
  startKnowledgeService,
  stopKnowledgeService,
} from '../extensions/knowledge/sdk/index.js';

/**
 * Execute a single explicit management operation; observation does not start the daemon.
 */
export async function runKnowledgeCli(args: string[]): Promise<void> {
  const [command, option, directory, ...extra] = args;
  const methods = {
    start: startKnowledgeService,
    stop: stopKnowledgeService,
    restart: restartKnowledgeService,
    status: getKnowledgeServiceStatus,
    health: checkKnowledgeServiceHealth,
  };
  if (
    !command ||
    !Object.hasOwn(methods, command) ||
    extra.length ||
    (option !== undefined && (option !== '--agent-dir' || !directory))
  ) {
    throw new Error('Usage: octopus knowledge service start|stop|restart|status|health [--agent-dir <path>]');
  }
  const result = await methods[command as keyof typeof methods](directory ?? getAgentDir());
  process.stdout.write(JSON.stringify(result) + '\n');
}
