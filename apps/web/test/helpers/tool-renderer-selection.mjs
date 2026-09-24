/**
 * @author Codex
 * @description Observes the public selection component through its render callback for deterministic contract tests.
 */
import { ToolRenderer } from '../../src/features/session/ToolRenderers/ToolRenderer.tsx';
/**
 * Exercises the same presentation selection used by ToolCard without exporting application internals.
 */
export function resolveToolRenderer(toolName) {
  let selected;
  ToolRenderer({
    toolName,
    children: (renderer) => {
      selected = renderer;
      return null;
    },
  });
  return selected;
}
