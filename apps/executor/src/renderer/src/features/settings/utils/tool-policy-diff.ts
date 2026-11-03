/**
 * @author Codex
 * @description Compares policy draft content independently of revisions and non-semantic list ordering.
 */
import type { ToolPolicySettings } from '../../../../../contracts/tool-policy';

/**
 * Normalizes only ordering; selected identity, names and tool membership remain meaningful changes.
 */
function policyContent(settings: ToolPolicySettings) {
  return {
    selectedId: settings.selectedId,
    custom: settings.custom
      .map((policy) => ({ id: policy.id, name: policy.name, enabledTools: [...policy.enabledTools].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/**
 * Treats a reverted policy draft as clean without mutating either saved settings or the draft.
 */
export function toolPoliciesEqual(left: ToolPolicySettings, right: ToolPolicySettings): boolean {
  return JSON.stringify(policyContent(left)) === JSON.stringify(policyContent(right));
}
