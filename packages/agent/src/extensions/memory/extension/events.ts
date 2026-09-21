/**
 * @author Codex
 * @description Session-scoped memory activation, cancellation and settled-run curation.
 */
import { readFileSync } from 'node:fs';
import { publishMemoryStatus } from './ui.js';
import { createPiMemoryCurator } from '../lib/curator.js';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { MemoryService } from '../services/memory-service.js';
import type { MemorySource, MemoryStatus } from '../definitions/types.js';
import type { MemoryBudget } from './tools.js';
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
  log: (event: string, error?: unknown) => void = () => {}
) {
  let budget: MemoryBudget = { calls: 0, pages: 0, searches: 0, bytes: 0 };
  let closed = false;
  let running: Promise<unknown> | undefined;
  let controller: AbortController | undefined;
  let baseline = new Set<string>();
  let successful = false;
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
    // Startup readiness must not wait for a shared service launch or migration.
    void (readOnly ? service.getStatus() : service.initialize())
      .then((status) => {
        if (closed) {
          return;
        }
        lastHealthy = status;
        degraded = false;
        publishMemoryStatus(ctx, status);
      })
      .catch((error: unknown) => {
        if (closed) {
          return;
        }
        log('session_start_failed', error);
        unavailable(ctx);
      });
  });
  pi.on('before_agent_start', async (event, ctx) => {
    await running;
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
            details?.items?.flatMap((item) =>
              item.ref
                ? [item.ref]
                : item.storeId && item.indexId
                  ? [{ storeId: item.storeId, indexId: item.indexId }]
                  : []
            ) ?? [];
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
      lastHealthy = status;
      if (degraded) {
        degraded = false;
        publishMemoryStatus(ctx, status);
        log('recovered');
      }
      if (!allowed() || status.mode === 'off') {
        return { messages };
      }
      const directory = await service.recall({ mode: 'page' }, 6500);
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
      unavailable(ctx);
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
    if (closed || readOnly || !successful || !allowed() || !ctx.isProjectTrusted()) {
      return;
    }
    const sources: MemorySource[] = ctx.sessionManager
      .getBranch()
      .flatMap((entry) => {
        if (baseline.has(entry.id) || entry.type !== 'message' || entry.message.role !== 'user') {
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
        return text.trim()
          ? [
              {
                sessionId: ctx.sessionManager.getSessionId(),
                entryId: entry.id,
                evidence: text.slice(0, 800),
              },
            ]
          : [];
      })
      .slice(-8);
    if (!sources.length) {
      return;
    }
    controller = new AbortController();
    const active = controller;
    const timeout = setTimeout(() => active.abort(), 10000);
    const signal = active.signal;
    running = (async () => {
      let status: MemoryStatus | undefined;
      try {
        status = await service.getStatus();
        lastHealthy = status;
        if (status.mode === 'off') {
          return;
        }
        publishMemoryStatus(ctx, status, 'running');
        const operation = service.evaluateRun(
          sources,
          createPiMemoryCurator(ctx),
          signal,
          sources.some((s) => /记住|以后.*遵循|remember this/iu.test(s.evidence))
        );
        const receipts = await Promise.race([
          operation,
          new Promise<never>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true })
          ),
        ]);
        if (!closed) {
          const settled = await service.getStatus();
          lastHealthy = settled;
          degraded = false;
          publishMemoryStatus(ctx, settled, receipts.length ? 'committed' : 'skipped');
          if (receipts.length) {
            pi.sendMessage(
              {
                customType: 'octopus-memory-operation',
                content: '已保存 ' + receipts.length + ' 条长期记忆。',
                display: true,
              },
              { triggerTurn: false }
            );
          }
        }
      } catch (error) {
        log(signal.aborted ? 'curator_cancelled' : 'curator_failed', error);
        if (!closed) {
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
    controller?.abort();
    successful = false;
  });
  pi.on('session_before_tree', () => {
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
    controller?.abort();
    await running;
    await service.dispose();
  });
  return () => budget;
}
