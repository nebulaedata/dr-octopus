/**
 * @author Codex
 * @description Adapts Pi events to the host-independent configured permission request normalizer.
 */
import { normalizePermissionRequest } from '../services/permission-request.js';
import type { ToolCallEvent } from '@earendil-works/pi-coding-agent';
import type { PermissionResolvedConfig } from '@octopus/shared/protocol';
export type { NormalizedToolPermission } from '../services/permission-request.js';

/**
 * Translate a tool event using the same effective configuration used for its decision.
 */
export function normalizeToolPermission(event: ToolCallEvent, cwd: string, config: PermissionResolvedConfig) {
  return normalizePermissionRequest(event.toolName, event.input, cwd, config);
}

/**
 * Treat direct shell execution as a configured tool without relying on tool registration.
 */
export function normalizeUserBashPermission(command: string, cwd: string, config: PermissionResolvedConfig) {
  return normalizePermissionRequest('user_bash', { command }, cwd, config);
}

/**
 * Extract a conventional command for unexpected gate error diagnostics only.
 */
export function getToolCommand(input: Record<string, unknown>): string | undefined {
  return typeof input['command'] === 'string' ? input['command'] : undefined;
}
