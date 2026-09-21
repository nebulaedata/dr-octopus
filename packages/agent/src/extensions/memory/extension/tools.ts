/**
 * @author Codex
 * @description Read-only model tools with service validation and a shared per-run recall budget.
 */
import { Type } from 'typebox';
import { MemoryError } from '../definitions/error.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { MemoryService } from '../services/memory-service.js';
export interface MemoryBudget {
  calls: number;
  searches: number;
  pages: number;
  bytes: number;
}
/**
 * Register stable tools; restrictions are checked at execution, not merely in prompts.
 */
export function registerMemoryTools(pi: ExtensionAPI, service: MemoryService, budget: () => MemoryBudget) {
  const ref = Type.Object(
    { storeId: Type.String({ minLength: 1, maxLength: 100 }), indexId: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false }
  );
  /**
   * Reserve the call allowance synchronously before any concurrent await.
   */
  function reserve(search = false, page = false) {
    const b = budget();
    if (++b.calls > 20 || (search && ++b.searches > 2) || (page && ++b.pages > 10) || b.bytes >= 44000) {
      throw new MemoryError('BUDGET_EXHAUSTED', '本轮记忆召回预算已用尽；本次未找到不表示从未讨论。');
    }
    return b;
  }
  /**
   * Respect persisted off policy and current mode tool restrictions.
   */
  async function enabled(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if ((await service.getStatus()).mode === 'off' || !pi.getActiveTools().includes('memory_read')) {
      throw new MemoryError('READ_ONLY', '当前模式未启用记忆召回。');
    }
  }
  /**
   * Keep the native textual contract intact while adding browser-safe structured details.
   */
  function result(details: object, b: MemoryBudget) {
    const text = JSON.stringify(details);
    b.bytes += Buffer.byteLength(text);
    if (b.bytes > 48000) {
      throw new MemoryError('BUDGET_EXHAUSTED', '本轮记忆正文预算已用尽。');
    }
    return { content: [{ type: 'text' as const, text }], details };
  }
  pi.registerTool({
    name: 'memory_recall',
    label: '召回记忆',
    description:
      '只读查询全局历史目录。search 必须提供 query，不能带 cursor；page 可带 cursor，不能带 query。先少量 search，必要时 page。预算或游标停止不表示没有历史记忆。',
    parameters: Type.Object(
      {
        mode: Type.Union([Type.Literal('search'), Type.Literal('page')]),
        query: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
        cursor: Type.Optional(Type.String({ maxLength: 1500 })),
      },
      { additionalProperties: false }
    ),
    async execute(_id, input, signal) {
      const b = reserve(input.mode === 'search', input.mode === 'page');
      await enabled(signal);
      const output = await service.recall(input);
      signal?.throwIfAborted();
      return result(output, b);
    },
  });
  pi.registerTool({
    name: 'memory_read',
    label: '读取记忆',
    description: '只读读取相关 Wiki 事实，最多 5 个引用；正文不足时使用 continuation，保留项目适用条件。',
    parameters: Type.Object(
      {
        refs: Type.Array(ref, { minItems: 1, maxItems: 5 }),
        continuation: Type.Optional(Type.String({ maxLength: 1500 })),
      },
      { additionalProperties: false }
    ),
    async execute(_id, input, signal) {
      const b = reserve();
      await enabled(signal);
      const output = await service.read(input);
      signal?.throwIfAborted();
      return result(output, b);
    },
  });
}
