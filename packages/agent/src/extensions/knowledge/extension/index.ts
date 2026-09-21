/**
 * @author Codex
 * @description Composes ordinary Session knowledge controls and scoped built-in tool registrations.
 */
import { registerKnowledgeMode } from './mode.js';
import { registerKnowledgeTools } from './tools.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Share one mode instance between controls and tools without starting the knowledge daemon.
 */
export function createKnowledgeExtension(options: { agentDir: string; workspaceId: string; cwd: string }) {
  return (pi: ExtensionAPI): void => {
    const mode = registerKnowledgeMode(pi);
    registerKnowledgeTools(pi, options, () => mode.selection());
  };
}
