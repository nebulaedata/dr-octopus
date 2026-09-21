/**
 * @author Codex
 * @description Registers child memory readers with readonly storage, recall budgets and bounded session lifetime.
 */
import { createMemoryService } from '../sdk/index.js';
import { registerMemoryTools } from './tools.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Create fresh readonly resources per child; no commands, curation, diagnostics or initialization writes.
 */
export function createMemoryChildExtension(options: { dataRoot?: string } = {}) {
  return (pi: ExtensionAPI): void => {
    const service = createMemoryService({ ...options, readOnly: true });
    let budget = { calls: 0, searches: 0, pages: 0, bytes: 0 };
    pi.on('agent_start', () => {
      budget = { calls: 0, searches: 0, pages: 0, bytes: 0 };
    });
    pi.on('session_shutdown', () => service.dispose());
    registerMemoryTools(pi, service, () => budget);
  };
}

export default createMemoryChildExtension();
