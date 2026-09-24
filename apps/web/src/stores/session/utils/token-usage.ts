/**
 * @author Codex
 * @description Normalizes Pi token usage and totals model requests within one conversation turn.
 */
import type { SessionProjectionState } from '../type';

export interface TokenUsage {
  input: number;
  output: number;
}

/**
 * Includes both cache categories in prompt volume; missing or invalid usage stays unknown.
 */
export function normalizeTokenUsage(value: unknown): TokenUsage | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const counts = ['input', 'output', 'cacheRead', 'cacheWrite'].map((key) => usage[key]);
  if (!counts.every((count) => typeof count === 'number' && Number.isFinite(count) && count >= 0)) {
    return undefined;
  }
  const [input, output, cacheRead, cacheWrite] = counts as number[];
  return { input: input! + cacheRead! + cacheWrite!, output: output! };
}

/**
 * Counts each assistant message once, including intermediate tool-call responses and billed retries.
 */
export function selectTurnTokenUsage(state: SessionProjectionState, turnId: string): TokenUsage | undefined {
  let total: TokenUsage | undefined;
  const seen = new Set<string>();
  for (const item of state.transcriptItems) {
    if (
      item.type !== 'message' ||
      item.turnId !== turnId ||
      item.id === state.currentAssistantId ||
      seen.has(item.id)
    ) {
      continue;
    }
    seen.add(item.id);
    const message = state.messagesById[item.id];
    if (message?.role !== 'assistant' || message.tokenUsage === undefined) {
      continue;
    }
    total ??= { input: 0, output: 0 };
    total.input += message.tokenUsage.input;
    total.output += message.tokenUsage.output;
  }
  return total;
}

/**
 * Keeps transcript token counts compact with one fractional digit.
 */
export function formatTokenCount(tokens: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);
}
