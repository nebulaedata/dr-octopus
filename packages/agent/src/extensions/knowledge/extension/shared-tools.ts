/**
 * @author Codex
 * @description Registers session-independent knowledge readers and model tools for parent and child sessions.
 */
import { createKnowledgeReadTools } from '../sdk/tools.js';
import { registerKnowledgeModelTools } from './model-tools.js';
import type { KnowledgeClient } from '../definitions/client.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Reuse tool definitions with caller-owned scope and lifecycle; registration performs no inference or transport.
 */
export function registerSharedKnowledgeTools(
  pi: Pick<ExtensionAPI, 'registerTool'>,
  client: KnowledgeClient
): void {
  for (const tool of createKnowledgeReadTools(client)) {
    pi.registerTool(tool);
  }
  registerKnowledgeModelTools(pi, client);
}
