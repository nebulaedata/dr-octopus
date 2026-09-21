/**
 * @author Codex
 * @description Merges validated permission overlays without mutating defaults or evaluating configuration as code.
 */
import type { PermissionConfig, PermissionResolvedConfig } from '@octopus/shared/protocol';

/**
 * Merge maps by exact name; arrays and complete tool descriptors replace inherited values.
 */
export function mergePermissionConfiguration(
  base: PermissionResolvedConfig,
  overlay: PermissionConfig
): PermissionResolvedConfig {
  const result = structuredClone(base);
  for (const [name, rule] of Object.entries(overlay.toolRules ?? {})) {
    if (rule === null) {
      delete result.toolRules[name];
    } else {
      result.toolRules[name] = structuredClone(rule);
    }
  }
  result.requestDefaults = { ...result.requestDefaults, ...overlay.requestDefaults };
  result.policy.tools = { ...result.policy.tools, ...overlay.policy?.tools };
  for (const name of ['ask', 'auto', 'full'] as const) {
    const mode = overlay.modes?.[name];
    result.modes[name] = {
      tools: { ...result.modes[name].tools, ...mode?.tools },
      kinds: { ...result.modes[name].kinds, ...mode?.kinds },
      external: mode?.external ?? result.modes[name].external,
    };
  }
  result.permissionReviewLog = overlay.permissionReviewLog ?? result.permissionReviewLog;
  result.reviewLogFieldMaxWidth = overlay.reviewLogFieldMaxWidth ?? result.reviewLogFieldMaxWidth;
  return result;
}
