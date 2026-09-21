/**
 * @author Codex
 * @description Adapts ordinary Pi Session mode controls, workflow mutex and per-turn knowledge policy without owning model selection.
 */
import { readFileSync } from 'node:fs';
import { modelToolNames } from '../definitions/model-tool-schemas.js';
import { parseKnowledgeModeConfig, parseKnowledgeModeState } from '@octopus/shared/protocol/knowledge';
import type { KnowledgeModeState } from '@octopus/shared/protocol/knowledge';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

const ENTRY = 'octopus-knowledge-mode';
const MUTEX = 'workflow:mutex:v1';
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
const activeKnowledgeTools = [...TOOL_NAMES, ...modelToolNames];
const skill = readFileSync(new URL('../skills/knowledge/SKILL.md', import.meta.url), 'utf8').replace(
  /^---[\s\S]*?---\s*/u,
  ''
);

interface StoredMode extends KnowledgeModeState {
  restoreTools?: string[];
}

/**
 * Register a lightweight mode on the existing Pi instance; no second Session or inference runtime is created.
 */
export function registerKnowledgeMode(pi: ExtensionAPI): {
  /**
   * Read the current Agent-owned collection restriction for every tool invocation.
   */
  selection(): readonly string[];
} {
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
    pi.events.emit(MUTEX, attempt);
    if (attempt.busy) {
      throw new Error('请先退出当前 Plan 工作流，再进入知识问答');
    }
  }
  pi.events.on(MUTEX, (payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const attempt = payload as { session?: object; group?: string; busy?: boolean };
    if ((state.enabled || switching) && attempt.session === session && attempt.group === 'agent-workflow') {
      attempt.busy = true;
    }
  });

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
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));
  pi.on('session_shutdown', () => {
    session = undefined;
    state = freshState();
  });
  pi.on('input', (_event, ctx) => {
    if (state.enabled && restoreError) {
      if (ctx.hasUI) {
        ctx.ui.notify(restoreError + '；请修复配置或 /knowledge off', 'error');
      }
      return { action: 'handled' as const };
    }
    return;
  });
  pi.on('before_agent_start', (event) => {
    if (!state.enabled) {
      if (state.restoreTools === undefined) {
        return;
      }
      return {
        systemPrompt:
          event.systemPrompt +
          '\n\n知识问答模式已退出，当前知识库集合、入库与检索工具不可用；ocr_image、embed_text、rerank_documents 仍可独立使用。以本轮可用工具列表为准，不得沿用历史对话中的知识库工具调用或检索计划。' +
          '若用户继续要求知识库检索或读取，直接说明“知识问答模式已退出，请切回知识问答模式后继续查询。”普通任务按当前模式正常处理。' +
          '若收到知识库集合、入库或检索工具 not found 或模式未开启的错误，停止本轮知识库调用，不要换工具或重试，也不要通过 Shell、HTTP 等方式绕过模式限制。',
      };
    }
    pi.setActiveTools(activeKnowledgeTools);
    return {
      systemPrompt:
        '你是知识库问答助手。当前处于知识问答模式，只使用当前可用的知识库工具及通用模型工具（ocr_image、embed_text、rerank_documents）。历史会话保留作背景，当前结论必须来自本轮检索证据。不得执行其他任务或调用其他工具。\n' +
        (state.collectionIds.length
          ? `限定集合 ID：${JSON.stringify(state.collectionIds)}。\n`
          : '集合自动匹配：仅在当前工作区和全局可见范围选择。\n') +
        skill,
    };
  });
  pi.on('tool_call', (event) => {
    if (
      (state.enabled && !activeKnowledgeTools.includes(event.toolName)) ||
      (!state.enabled && TOOL_NAMES.includes(event.toolName))
    ) {
      return {
        block: true,
        reason: state.enabled
          ? '知识问答模式仅允许当前可用的知识库工具及通用模型工具'
          : '知识问答模式未开启或已退出。停止知识库工具调用，不要换工具重试；请提示用户切回知识问答模式后继续查询。',
      };
    }
    return;
  });
  pi.on('user_bash', () =>
    state.enabled
      ? {
          result: {
            output: '知识问答模式不能执行 Shell 命令',
            exitCode: 1,
            cancelled: false,
            truncated: false,
          },
        }
      : undefined
  );
  return { selection: () => (state.enabled ? state.collectionIds : []) };
}

/**
 * Provide an automatic-selection mode without persisting defaults in unrelated sessions.
 */
function freshState(): StoredMode {
  return { version: 1, enabled: false, collectionIds: [] };
}
