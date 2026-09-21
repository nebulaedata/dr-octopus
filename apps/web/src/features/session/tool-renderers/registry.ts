/**
 * @author Codex
 * @description Resolves a deterministic tool renderer from product-specific and Pi built-in registrations.
 */

import { BUILTIN_TOOL_RENDERERS, FALLBACK_TOOL_RENDERER } from './builtin-tool-renderer-definitions';
import { CUSTOM_TOOL_RENDERERS } from './custom-tool-renderer-definitions';
import type { ToolRendererDefinition } from './types';

const TOOL_RENDERERS = [...CUSTOM_TOOL_RENDERERS, ...BUILTIN_TOOL_RENDERERS];

/**
 * Resolves the first explicitly registered renderer and otherwise returns the safe fallback.
 *
 * @param toolName - Exact Pi tool name.
 * @returns Renderer definition for the tool.
 */
export function resolveToolRenderer(toolName: string): ToolRendererDefinition {
  return TOOL_RENDERERS.find((renderer) => renderer.names.includes(toolName)) ?? FALLBACK_TOOL_RENDERER;
}
