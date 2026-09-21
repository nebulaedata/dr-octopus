/**
 * @author Codex
 * @description Preserves existing MCP search and allowlist modes through the simplified tool-exposure switch.
 */
import type { McpServerDetailDto } from '@octopus/shared/protocol';

/**
 * Treats every configured direct-tool strategy as enabled, including lazy search activation.
 */
export function isDirectToolsEnabled(mode: McpServerDetailDto['directTools'] | undefined): boolean {
  return mode === true || mode === 'search' || Array.isArray(mode);
}

/**
 * Keeps the existing strategy on unrelated edits; an explicit off switch removes direct exposure.
 */
export function resolveDirectTools(
  enabled: boolean,
  previous: McpServerDetailDto['directTools'] | undefined
): McpServerDetailDto['directTools'] {
  return enabled ? (previous === 'search' || Array.isArray(previous) ? previous : true) : false;
}
