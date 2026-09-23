/**
 * @author Codex
 * @description Session-scoped memory activation, cancellation and settled-run curation.
 */
import { readFileSync } from 'node:fs';
import { publishMemoryStatus } from './ui.js';
import { createPiMemoryCurator } from '../lib/curator.js';
import { selectMemoryRun } from '../services/run-policy.js';
import type { MemoryDiagnosticDetails } from './diagnostics.js';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { MemoryService } from '../services/memory-service.js';
import type { MemorySource, MemoryStatus } from '../definitions/types.js';
import type { MemoryBudget } from './tools.js';
import type { MemoryScreenResult } from '../lib/jev-screen.js';
const CONTEXT = 'octopus-memory-context';
const skill = readFileSync(new URL('../skills/memory/SKILL.md', import.meta.url), 'utf8').replace(
  /^---[\s\S]*?---\s*/u,
  ''
);
/**
 * Register lazy initialization, transient context and a tracked ten-second curator task.
 */
export function registerMemoryEvents(
  pi: ExtensionAPI,
  service: MemoryService,
  readOnly: boolean,
  log: (event: string, error?: unknown, details?: MemoryDiagnosticDetails) => void = () => {},
  screen?: (sources: MemorySource[], signal: AbortSignal) => Promise<MemoryScreenResult>
) {
  let budget: MemoryBudget = { calls: 0, pages: 0, searches: 0, bytes: 0 };
  let closed = false;
  let generation = 0;
  let running: Promise<unknown> | undefined;
  let controller: AbortController | undefined;
  let baseline = new Set<string>();
  let successful = false;
  let pendingRun = false;
  let lastHealthy: MemoryStatus | undefined;
  let degraded = false;
  /**
   * Turn model/tool restrictions into one shared eligibility decision.
   */
  const allowed = () =>
    pi.getActiveTools().includes('memory_read') && pi.getActiveTools().includes('memory_recall');
  /**
   * Publish store failure without pretending the mode changed, and queue one republish for after recovery.
   */
  function unavailable(ctx: ExtensionContext) {
    degraded = true;
    publishMemoryStatus(
      ctx,
      lastHealthy
        ? { ...lastHealthy, availability: 'unavailable' }
        : { version: 1, mode: 'off', revision: 0, writeEpoch: 0, count: 0, availability: 'unavailable' },
      'idle',
      'STORE_UNAVAILABLE'
    );
  }
  pi.on('session_start', (_event, ctx) => {
    const current = ++generation;
    controller?.abort();
    successful = false;
    pendingRun = false;
    baseline = new Set();
    lastHealthy = undefined;
    // Startup readiness must not wait for a shared service launch or migration.
    void (readOnly ? service.getStatus() : service.initialize())
      .then((status) => {
        if (closed || current !== generation) {
          return;
        }
        lastHealthy = status;
        degraded = false;
        publishMemoryStatus(ctx, status);
      })
      .catch((error: unknown) => {
        if (closed || current !== generation) {
          return;
        }
        log('session_start_failed', error);
        unavailable(ctx);
      });
  });
  pi.on('before_agent_start', async (event, ctx) => {
    await running;
    if (closed) {
      return;
    }
    pendingRun = true;
    budget = { calls: 0, pages: 0, searches: 0, bytes: 0 };
    successful = false;
    baseline = new Set(ctx.sessionManager.getBranch().map((entry) => entry.id));
    if (allowed()) {
      return {
        systemPrompt: event.systemPrompt + '\n\n' + skill,
      };
    }
    return;
  });
  pi.on('context', async (event, ctx) => {
    const current = generation;
    const messages = event.messages.filter(
      (message) => !(message.role === 'custom' && message.customType === CONTEXT)
    );
    try {
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (
          message?.role === 'toolResult' &&
          (message.toolName === 'memory_read' || message.toolName === 'memory_recall')
        ) {
          const details = message.details as
            | {
                items?: Array<{
                  ref?: { storeId: string; indexId: number };
                  storeId?: string;
                  indexId?: number;
                }>;
              }
            | undefined;
          const refs =
            details?.items?.flatMap((item) => {
              if (item.ref) {
                return [item.ref];
              }
              if (item.storeId && item.indexId) {
                return [{ storeId: item.storeId, indexId: item.indexId }];
              }
              return [];
            }) ?? [];
          if (refs.length && (await service.hasMissing(refs))) {
            messages[i] = {
              ...message,
              content: [{ type: 'text', text: '此历史结果含已删除或已替代的记忆，请重新查询。' }],
              details: undefined,
            };
          }
        }
      }
      const status = await service.getStatus();
      if (closed || current !== generation) {
        return { messages };
      }
      const recovered = degraded;
      const publish = degraded || lastHealthy === undefined;
      lastHealthy = status;
      if (publish) {
        degraded = false;
        publishMemoryStatus(ctx, status);
        if (recovered) {
          log('recovered');
        }
      }
      if (!allowed() || status.mode === 'off') {
        return { messages };
      }
      const directory = await service.recall({ mode: 'page' }, 6500);
      if (closed || current !== generation) {
        return { messages };
      }
      messages.push({
        role: 'custom',
        customType: CONTEXT,
        content: 'Historical navigation only. Read relevant sections. ' + JSON.stringify(directory),
        display: false,
        timestamp: Date.now(),
      });
      return { messages };
    } catch (error) {
      log('context_failed', error);
      if (!closed && current === generation) {
        unavailable(ctx);
      }
      return {
        messages: messages.map((message) =>
          message.role === 'toolResult' &&
          (message.toolName === 'memory_read' || message.toolName === 'memory_recall')
            ? {
                ...message,
                content: [{ type: 'text' as const, text: '暂时无法校验历史记忆，请待服务恢复后重新查询。' }],
                details: undefined,
              }
            : message
        ),
      };
    }
  });
  pi.on('agent_end', (event) => {
    const last = [...event.messages].reverse().find((message) => message.role === 'assistant');
    successful = last?.role === 'assistant' && last.stopReason !== 'error' && last.stopReason !== 'aborted';
  });
  pi.on('agent_settled', async (_event, ctx) => {
    if (closed || !pendingRun) {
      return;
    }
    // Consume eligibility before the first await: duplicate settled events cannot launch another task.
    pendingRun = false;
    const completedSuccessfully = successful;
    successful = false;
    const current = generation;
    const sessionId = ctx.sessionManager.getSessionId();
    const branch = ctx.sessionManager.getBranch().flatMap((entry): MemorySource[] => {
      if (entry.type !== 'message' || entry.message.role !== 'user') {
        return [];
      }
      const content = entry.message.content;
      const text =
        typeof content === 'string'
          ? content
          : content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join(' ');
      return text.trim() ? [{ sessionId, entryId: entry.id, evidence: text.slice(0, 800) }] : [];
    });
    const run = selectMemoryRun(branch, baseline);
    const explicit = run.intent === 'explicit';
    const diagnostic = { sessionId, trigger: run.intent, sourceCount: run.sources.length };
    /**
     * Send a durable non-success response only for an explicit save request in the same Session.
     */
    function outcome(reason: string, content: string) {
      log('curator_skipped', undefined, { ...diagnostic, reason });
      if (explicit && !closed && current === generation) {
        pi.sendMessage(
          { customType: 'octopus-memory-outcome', content, display: true },
          { triggerTurn: false }
        );
      }
    }
    if (!run.sources.length) {
      log('curator_skipped', undefined, {
        ...diagnostic,
        reason: run.intent === 'declined' ? 'USER_DECLINED' : 'NO_NEW_EVIDENCE',
      });
      return;
    }
    if (!completedSuccessfully) {
      outcome('RUN_UNSUCCESSFUL', '本次未执行长期记忆整理：对话已中止或失败。');
      return;
    }
    if (readOnly) {
      outcome('READ_ONLY', '本次未保存长期记忆：当前 Agent 为只读模式，不允许写入。');
      return;
    }
    if (!allowed()) {
      outcome('TOOLS_RESTRICTED', '本次未保存长期记忆：当前会话未启用记忆工具，不允许写入。');
      return;
    }
    if (!ctx.isProjectTrusted()) {
      outcome('PROJECT_UNTRUSTED', '本次未保存长期记忆：当前项目尚未受信任，不允许写入。');
      return;
    }
    controller = new AbortController();
    const active = controller;
    let timeout = setTimeout(() => active.abort(), 10000);
    const signal = active.signal;
    running = (async () => {
      let status: MemoryStatus | undefined;
      try {
        status = await service.getStatus();
        signal.throwIfAborted();
        if (closed || current !== generation) {
          return;
        }
        lastHealthy = status;
        if (status.mode === 'off' || (status.mode === 'manual' && !explicit)) {
          publishMemoryStatus(ctx, status, 'skipped');
          outcome('POLICY_DISABLED', '本次未保存长期记忆：自动记忆已关闭。请先在记忆设置中启用。');
          return;
        }
        publishMemoryStatus(ctx, status, 'running');
        if (!explicit && status.mode === 'auto' && screen) {
          const screened = await screen(run.sources, signal);
          signal.throwIfAborted();
          if (closed || current !== generation) {
            return;
          }
          if (screened.reason !== 'DISABLED') {
            log('jev_memory_screened', undefined, { ...diagnostic, reason: screened.reason });
            // The optional screen must not consume the existing curator's model budget.
            clearTimeout(timeout);
            timeout = setTimeout(() => active.abort(), 10000);
          }
          if (screened.skip) {
            const observed = await service.getStatus();
            signal.throwIfAborted();
            if (!closed && current === generation) {
              publishMemoryStatus(ctx, observed, 'skipped');
            }
            return;
          }
        }
        if (!allowed() || !ctx.isProjectTrusted()) {
          publishMemoryStatus(ctx, status, 'skipped');
          outcome('NOT_ELIGIBLE', '本次未保存长期记忆：会话权限已变化。');
          return;
        }
        log('curator_started', undefined, diagnostic);
        const operation = service.evaluateRun(
          run.sources,
          createPiMemoryCurator(ctx, (attempt, candidateCount) => {
            log('curator_evaluated', undefined, {
              ...diagnostic,
              attempt,
              candidateCount,
              model: ctx.model ? ctx.model.provider + '/' + ctx.model.id : undefined,
            });
          }),
          signal,
          explicit
        );
        const receipts = await Promise.race([
          operation,
          new Promise<never>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true })
          ),
        ]);
        signal.throwIfAborted();
        const settled = await service.getStatus();
        if (closed || current !== generation) {
          return;
        }
        lastHealthy = settled;
        degraded = false;
        publishMemoryStatus(ctx, settled, receipts.length ? 'committed' : 'skipped');
        if (receipts.length) {
          log('curator_committed', undefined, { ...diagnostic, receiptCount: receipts.length });
          pi.sendMessage(
            {
              customType: 'octopus-memory-operation',
              content: '已保存 ' + receipts.length + ' 条长期记忆。',
              display: true,
            },
            { triggerTurn: false }
          );
        } else {
          outcome(
            'NO_CHANGES',
            '本次没有新增长期记忆：未得到可提交的新事实（也可能内容已存在或来源已被删除）。请明确写出需要记住的具体内容。'
          );
        }
      } catch (error) {
        log(signal.aborted ? 'curator_cancelled' : 'curator_failed', error, diagnostic);
        if (!closed && current === generation) {
          if (status) {
            publishMemoryStatus(
              ctx,
              status,
              signal.aborted ? 'skipped' : 'failed',
              signal.aborted ? 'CANCELLED' : 'CURATION_FAILED'
            );
          } else {
            unavailable(ctx);
          }
          if (explicit) {
            pi.sendMessage(
              {
                customType: 'octopus-memory-outcome',
                content: '本次未能确认长期记忆保存成功：整理超时、取消或服务不可用。请查看记忆状态后重试。',
                display: true,
              },
              { triggerTurn: false }
            );
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    })();
    try {
      await running;
    } finally {
      running = undefined;
      controller = undefined;
    }
  });
  pi.on('session_before_switch', () => {
    generation++;
    pendingRun = false;
    controller?.abort();
    successful = false;
  });
  pi.on('session_before_tree', () => {
    generation++;
    pendingRun = false;
    controller?.abort();
    successful = false;
  });
  pi.on('session_tree', () => {
    controller?.abort();
    baseline = new Set();
    successful = false;
  });
  pi.on('session_shutdown', async () => {
    closed = true;
    generation++;
    controller?.abort();
    await service.dispose();
    // SDK disposal cancels initialization; its late callback is fenced above and must not block shutdown.
    await running;
  });
  return () => budget;
}
