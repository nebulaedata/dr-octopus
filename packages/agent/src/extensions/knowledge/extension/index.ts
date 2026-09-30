/**
 * @author Codex
 * @description Composes ordinary Session knowledge controls and scoped built-in tool registrations.
 */
import { createKnowledgeMode } from './mode.js';
import { registerKnowledgeEvents } from './events.js';
import { registerKnowledgeTools } from './tools.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Share one mode instance between controls and tools without starting the knowledge daemon.
 */
export function createKnowledgeExtension(options: { agentDir: string; workspaceId: string; cwd: string }) {
  return (pi: ExtensionAPI): void => {
    const mode = createKnowledgeMode(pi);
    registerKnowledgeEvents(pi, mode);
    registerKnowledgeTools(pi, options, () => mode.selection());
  };
}
