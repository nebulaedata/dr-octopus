/**
 * @author Codex
 * @description Owns knowledge mode controls, branch state and tool transitions without registering Pi lifecycle or policy events.
 */
import { modelToolNames } from '../definitions/model-tool-schemas.js';
import { parseKnowledgeModeConfig, parseKnowledgeModeState } from '@octopus/shared/protocol/knowledge';
import type { KnowledgeModeState } from '@octopus/shared/protocol/knowledge';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

const ENTRY = 'octopus-knowledge-mode';
export const KNOWLEDGE_WORKFLOW_MUTEX = 'workflow:mutex:v1';
const TOOL_NAMES = [
  'knowledge_list_collections',
  'knowledge_search',
  'knowledge_read',
  'knowledge_import_attachment',
  'knowledge_create_collection',
  'knowledge_add_text',
  'knowledge_import',
  'knowledge_job_status',
];
const activeKnowledgeTools = [...TOOL_NAMES, ...modelToolNames, 'read'];
interface StoredMode extends KnowledgeModeState {
  restoreTools?: string[];
}

/**
 * Create mode controls and keep branch state, workflow ownership and tool transitions private to one extension instance.
 */
export function createKnowledgeMode(pi: ExtensionAPI) {
  let state: StoredMode = freshState();
  let session: object | undefined;
  let switching = false;
  let restoreError: string | undefined;

  /**
   * Persist branch-owned state and publish live state even before Pi flushes the first assistant message.
   */
  function publish(ctx: ExtensionContext, persist = true): void {
    if (persist) {
      pi.appendEntry(ENTRY, state);
    }
    if (ctx.mode === 'rpc') {
      ctx.ui.setStatus(ENTRY, JSON.stringify(parseKnowledgeModeState(state)));
    } else if (ctx.hasUI) {
      ctx.ui.setStatus(ENTRY, state.enabled ? '知识问答' : undefined);
    }
  }

  /**
   * Respect the pinned Plan extension's public workflow mutex without changing its private state or commands.
   */
  function acquire(ctx: ExtensionContext): void {
    session = ctx.sessionManager;
    const attempt = { session, group: 'agent-workflow', busy: false };
    pi.events.emit(KNOWLEDGE_WORKFLOW_MUTEX, attempt);
    if (attempt.busy) {
      throw new Error('请先退出当前 Plan 工作流，再进入知识问答');
    }
  }
  /**
   * Claim competing workflow attempts only while this Session owns knowledge mode or a transition.
   */
  function claimWorkflow(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const attempt = payload as { session?: object; group?: string; busy?: boolean };
    if ((state.enabled || switching) && attempt.session === session && attempt.group === 'agent-workflow') {
      attempt.busy = true;
    }
  }

  /**
   * Apply validated scope and tool changes as one idle transition while preserving the Session model.
   */
  function change(ctx: ExtensionContext, enabled: boolean, config = parseKnowledgeModeConfig(state)): void {
    if (switching || !ctx.isIdle() || ctx.hasPendingMessages()) {
      throw new Error('请等待当前回答和排队消息完成后再切换知识问答');
    }
    if (enabled && !state.enabled) {
      acquire(ctx);
    }
    switching = true;
    const previous = state;
    const currentTools = pi.getActiveTools();
    try {
      const next: StoredMode = { ...state, ...config, enabled };
      if (enabled && !state.enabled) {
        next.restoreTools = currentTools.filter((name) => !TOOL_NAMES.includes(name));
      }
      if (enabled || state.enabled) {
        pi.setActiveTools(
          enabled
            ? activeKnowledgeTools
            : (state.restoreTools ?? currentTools).filter((name) => !TOOL_NAMES.includes(name))
        );
      }
      state = next;
      restoreError = undefined;
      publish(ctx);
    } catch (error) {
      state = previous;
      pi.setActiveTools(currentTools);
      throw error;
    } finally {
      switching = false;
    }
  }

  pi.registerCommand('knowledge', {
    description: '知识问答：/knowledge on|off|status|config <JSON>；空集合自动匹配，回答使用当前会话模型',
    /**
     * Adapt synchronous mode controls to Pi's asynchronous command contract.
     */
    handler(args, ctx) {
      return Promise.resolve().then(() => {
        const command = args.trim();
        if (command === 'status') {
          publish(ctx, false);
          return;
        }
        if (command === 'on' || command === 'off') {
          change(ctx, command === 'on');
          return;
        }
        if (command.startsWith('config ')) {
          change(ctx, state.enabled, parseKnowledgeModeConfig(JSON.parse(command.slice(7))));
          return;
        }
        throw new Error('用法：/knowledge on|off|status|config {"collectionIds":[]}');
      });
    },
  });

  /**
   * Restore branch state on startup/reload/tree navigation and keep failure closed within knowledge tools.
   */
  function restore(ctx: ExtensionContext): void {
    const previousTools = state.enabled ? state.restoreTools : undefined;
    session = undefined;
    switching = false;
    restoreError = undefined;
    const entry = [...ctx.sessionManager.getBranch()]
      .reverse()
      .find((item) => item.type === 'custom' && item.customType === ENTRY);
    const stored = entry?.type === 'custom' ? (entry.data as StoredMode) : undefined;
    state = freshState();
    const parsed = parseKnowledgeModeState(stored);
    if (parsed) {
      state = {
        ...parsed,
        restoreTools: Array.isArray(stored?.restoreTools)
          ? [
              ...new Set([
                ...stored.restoreTools.filter(
                  (name) => typeof name === 'string' && !TOOL_NAMES.includes(name)
                ),
                ...pi.getActiveTools().filter((name) => modelToolNames.includes(name)),
              ]),
            ]
          : undefined,
      };
    }
    const enabled = state.enabled;
    state.enabled = false;
    try {
      if (enabled) {
        acquire(ctx);
      }
      state.enabled = enabled;
    } catch (error) {
      state.enabled = enabled;
      restoreError = error instanceof Error ? error.message : '知识模式恢复失败';
    }
    pi.setActiveTools(
      enabled
        ? activeKnowledgeTools
        : (previousTools ?? pi.getActiveTools()).filter((name) => !TOOL_NAMES.includes(name))
    );
    publish(ctx, false);
  }
  return {
    /**
     * Read the current collection restriction for scoped tool execution.
     */
    selection: (): readonly string[] => (state.enabled ? [...state.collectionIds] : []),
    /**
     * Provide a detached policy snapshot without exposing mutable branch state.
     */
    snapshot: () => ({
      enabled: state.enabled,
      exited: state.restoreTools !== undefined,
      collectionIds: [...state.collectionIds],
      restoreError,
    }),
    restore,
    claimWorkflow,
    /**
     * Release Session ownership and discard transient mode state on shutdown.
     */
    reset(): void {
      session = undefined;
      state = freshState();
    },
    /**
     * Reapply the knowledge tool allowance before a model turn.
     */
    activateTools(): void {
      pi.setActiveTools(activeKnowledgeTools);
    },
    /**
     * Check mode tool membership; event adapters additionally fence skill-file reads.
     */
    allowsTool: (name: string) =>
      state.enabled ? activeKnowledgeTools.includes(name) : !TOOL_NAMES.includes(name),
  };
}

/**
 * Provide an automatic-selection mode without persisting defaults in unrelated sessions.
 */
function freshState(): StoredMode {
  return { version: 1, enabled: false, collectionIds: [] };
}

/**
 * Mode contract inferred from its controls; event adapters receive no mutable state.
 */
export type KnowledgeMode = ReturnType<typeof createKnowledgeMode>;
