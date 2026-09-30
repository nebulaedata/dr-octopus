/**
 * @author Codex
 * @description Registers knowledge skill discovery, Session lifecycle and per-turn mode policy on the public Pi event surfaces.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_WORKFLOW_MUTEX } from './mode.js';
import type { KnowledgeMode } from './mode.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const skillDirectory = fileURLToPath(new URL('../skills/knowledge/', import.meta.url));
const skillPath = resolve(skillDirectory, 'SKILL.md');

/**
 * Bind event adapters to the one mode instance shared by controls and scoped tools.
 */
export function registerKnowledgeEvents(pi: ExtensionAPI, mode: KnowledgeMode): void {
  pi.on('resources_discover', () => ({ skillPaths: [skillDirectory] }));
  pi.events.on(KNOWLEDGE_WORKFLOW_MUTEX, (payload: unknown) => mode.claimWorkflow(payload));
  pi.on('session_start', (_event, ctx) => mode.restore(ctx));
  pi.on('session_tree', (_event, ctx) => mode.restore(ctx));
  pi.on('session_shutdown', () => {
    mode.reset();
  });
  pi.on('input', (_event, ctx) => {
    const state = mode.snapshot();
    if (state.enabled && state.restoreError) {
      if (ctx.hasUI) {
        ctx.ui.notify(state.restoreError + '；请修复配置或 /knowledge off', 'error');
      }
      return { action: 'handled' as const };
    }
    return;
  });
  pi.on('before_agent_start', (event) => {
    const state = mode.snapshot();
    if (!state.enabled) {
      if (!state.exited) {
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
    mode.activateTools();
    return {
      systemPrompt:
        event.systemPrompt +
        '\n\n' +
        '你是知识库问答助手。当前处于知识问答模式，只使用当前可用的知识库工具及通用模型工具（ocr_image、embed_text、rerank_documents），read 仅用于读取内置 knowledge Skill。历史会话保留作背景，当前结论必须来自本轮检索证据。不得执行其他任务或调用其他工具。\n' +
        (state.collectionIds.length
          ? `限定集合 ID：${JSON.stringify(state.collectionIds)}。\n`
          : '集合自动匹配：仅在当前工作区和全局可见范围选择。\n') +
        '使用前用 read 读取 knowledge Skill；read 仅允许读取内置 knowledge/SKILL.md，不得读取其他文件。',
    };
  });
  pi.on('tool_call', (event, ctx) => {
    const state = mode.snapshot();
    if (state.enabled && event.toolName === 'read') {
      const path = event.input.path;
      const target = typeof path === 'string' ? resolve(ctx.cwd, path) : '';
      const matches =
        process.platform === 'win32'
          ? target.toLowerCase() === skillPath.toLowerCase()
          : target === skillPath;
      return matches
        ? undefined
        : {
            block: true,
            reason: '知识问答模式的 read 仅允许读取内置 knowledge/SKILL.md',
          };
    }
    if (!mode.allowsTool(event.toolName)) {
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
    mode.snapshot().enabled
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
}
