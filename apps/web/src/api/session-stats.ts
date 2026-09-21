/**
 * @author Codex
 * @description Reads and validates Pi's authoritative cumulative session statistics.
 */
import { z } from 'zod';
import { request } from '@/utils/request';
import { t } from '@/i18n/translate';

const count = z.number().finite().nonnegative();
export const sessionStatsSchema = z.object({
  sessionId: z.string(),
  userMessages: count,
  assistantMessages: count,
  toolCalls: count,
  toolResults: count,
  totalMessages: count,
  tokens: z.object({ input: count, output: count, cacheRead: count, cacheWrite: count, total: count }),
  cost: count,
});

/**
 * Unwraps the RPC response returned by the stats endpoint, preserving command failures as query errors.
 */
export async function getSessionStats(workspaceId: string, sessionId: string, signal?: AbortSignal) {
  const response = await request<unknown>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/stats`,
    method: 'GET',
    signal,
  });
  const envelope = z
    .object({ success: z.boolean(), data: z.unknown().optional(), error: z.string().optional() })
    .parse(response);
  if (!envelope.success) {
    throw new Error(envelope.error ?? t('api.sessionStats.unavailable', 'Unable to read session statistics'));
  }
  return sessionStatsSchema.parse(envelope.data);
}
