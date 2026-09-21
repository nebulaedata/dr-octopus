/**
 * @author Codex
 * @description Satisfies child tool discovery while hiding and denying built-in tools outside the parent snapshot.
 */
import { createKnowledgeChildExtension } from '../knowledge/extension/child-entry.js';
import { createMemoryChildExtension } from '../memory/extension/child-entry.js';
import { evaluateDelegatedPermission } from '../permission-system/sdk/index.js';
import { CHILD_TOOLS } from './contracts.js';
import type { ChildScope } from './contracts.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Keep stable definitions for Pi's getAllTools preflight, with a separate fail-closed execution boundary.
 */
export function createScopedChildExtension(scope: ChildScope) {
  return (pi: ExtensionAPI): void => {
    const allowed = new Set(scope.tools);
    const registered = new Set<string>();
    if (!allowed.has('memory_read') || !allowed.has('memory_recall')) {
      allowed.delete('memory_read');
      allowed.delete('memory_recall');
    }
    const denied = new Set<string>(CHILD_TOOLS.filter((name) => !allowed.has(name)));
    const guardedPi: ExtensionAPI = {
      ...pi,
      /**
       * Even explicit reactivation or a stale tool call must never reach an unauthorized service.
       */
      registerTool(tool) {
        if (!(CHILD_TOOLS as readonly string[]).includes(tool.name)) {
          return;
        }
        if (registered.has(tool.name)) {
          throw new Error(`CHILD_TOOL_DUPLICATE: ${tool.name}`);
        }
        registered.add(tool.name);
        pi.registerTool({
          ...tool,
          /**
           * Check the frozen parent capability before executing any service operation.
           */
          execute(...args) {
            if (denied.has(tool.name)) {
              throw new Error(`CHILD_TOOL_NOT_AUTHORIZED: 父会话未授权 ${tool.name}`);
            }
            const decision = evaluateDelegatedPermission(scope.permissions, tool.name, args[1], args[4].cwd);
            if (decision.decision !== 'allow') {
              const code =
                decision.decision === 'ask' ? 'CHILD_PERMISSION_REQUIRED' : 'CHILD_PERMISSION_DENIED';
              throw new Error(`${code}: ${tool.name} (${decision.source}); 请在父会话处理权限后重新委派`);
            }
            return tool.execute(...args);
          },
        });
      },
    };
    createKnowledgeChildExtension({ ...scope, tools: CHILD_TOOLS })(guardedPi);
    createMemoryChildExtension()(guardedPi);
    const missing = CHILD_TOOLS.filter((name) => !registered.has(name));
    if (missing.length || registered.size !== CHILD_TOOLS.length) {
      throw new Error(`CHILD_TOOL_REGISTRATION_INVALID: ${missing.join(', ')}`);
    }
    /**
     * Hide unauthorized definitions from model menus without mutating the shared agent file per session.
     */
    function restrictActiveTools(): void {
      pi.setActiveTools(pi.getActiveTools().filter((name) => !denied.has(name)));
    }
    pi.on('session_start', restrictActiveTools);
    pi.on('before_agent_start', restrictActiveTools);
  };
}
