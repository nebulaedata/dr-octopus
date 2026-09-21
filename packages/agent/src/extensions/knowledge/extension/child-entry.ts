/**
 * @author Codex
 * @description Registers shared knowledge and model tools with child scope and no daemon ownership.
 */
import { createKnowledgeClient } from '../sdk/client.js';
import { registerSharedKnowledgeTools } from './shared-tools.js';
import { scopeKnowledgeClient } from '../services/mode-policy.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Bind immutable Host scope; the generated default entry supplies context outside model arguments.
 */
export function createKnowledgeChildExtension(options: {
  agentDir: string;
  workspaceId: string;
  collectionIds: readonly string[];
  tools: readonly string[];
}) {
  return (pi: ExtensionAPI): void => {
    const client = scopeKnowledgeClient(
      createKnowledgeClient({
        agentDir: options.agentDir,
        autostart: false,
        context: {
          principal: 'agent:' + options.workspaceId,
          workspaceId: options.workspaceId,
          globalWrite: false,
          modelAccess: 'invoke',
        },
      }),
      () => options.collectionIds
    );
    registerSharedKnowledgeTools(
      {
        /**
         * Select shared definitions by name without maintaining a second child implementation.
         */
        registerTool(tool) {
          if (options.tools.includes(tool.name)) {
            pi.registerTool(tool);
          }
        },
      },
      client
    );
  };
}
