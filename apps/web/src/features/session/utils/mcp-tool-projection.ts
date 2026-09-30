/**
 * @author Codex
 * @description Reads the invoked tool identity from the MCP proxy's structured arguments.
 */
import { readString } from './tool-renderer-utils';
import type { ToolProjection } from '@/stores/session';

/**
 * Keeps the exact remote tool name while tolerating discovery calls and incomplete streamed arguments.
 */
export function mcpToolLabel(tool: ToolProjection): string | undefined {
  if (tool.name !== 'mcp') {
    return undefined;
  }
  const name = readString(tool.arguments, 'tool')?.trim();
  return name && name.length <= 512 ? name : undefined;
}
