/**
 * @author Codex
 * @description Explains delegation admission without registering extensions or starting tool providers.
 */
import { CHILD_TOOLS } from './contracts.js';
import { evaluateDelegatedPermission } from '../permission-system/sdk/index.js';
import type { DelegatedPermissionSnapshot } from '../permission-system/sdk/index.js';

export interface DelegationInspection {
  activeTools: readonly string[];
  registeredTools: readonly string[];
  knowledgeEnabled: boolean;
  permissions: DelegatedPermissionSnapshot;
  cwd: string;
  childTools?: readonly string[];
}

/**
 * Explain the first exclusion; admission with empty arguments still requires a per-call permission check.
 */
export function inspectDelegatedTools(input: DelegationInspection, names: readonly string[] = CHILD_TOOLS) {
  const candidates = [...new Set([...names, 'memory_read', 'memory_recall'])];
  const rows = candidates.map((name) => {
    let reason = 'eligible';
    let source: string | undefined;
    if (!(CHILD_TOOLS as readonly string[]).includes(name)) {
      reason = 'not_delegatable';
    } else if (!input.registeredTools.includes(name)) {
      reason = 'parent_tool_missing';
    } else if (!input.activeTools.includes(name)) {
      reason = 'parent_tool_inactive';
    } else if (name.startsWith('knowledge_') && !input.knowledgeEnabled) {
      reason = 'knowledge_mode_disabled';
    } else if (input.childTools && !input.childTools.includes(name)) {
      reason = 'child_allowlist_excluded';
    } else {
      const decision = evaluateDelegatedPermission(input.permissions, name, {}, input.cwd);
      source = decision.source;
      if (decision.decision !== 'allow') {
        reason = `permission_${decision.decision}`;
      }
    }
    return { name, eligible: reason === 'eligible', reason, ...(source ? { source } : {}) };
  });
  const memory = rows.filter((row) => ['memory_read', 'memory_recall'].includes(row.name));
  if (memory.some((row) => !row.eligible)) {
    for (const row of memory) {
      if (row.eligible) {
        row.eligible = false;
        row.reason = 'memory_pair_required';
      }
    }
  }
  return rows.filter((row) => names.includes(row.name));
}
