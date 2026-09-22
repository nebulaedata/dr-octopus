/**
 * @author Codex
 * @description Shares the durable startup receipt between home submission and Session route activation.
 */
import { queryOptions } from '@tanstack/react-query';
import { request } from '@/utils/request';
import type { ConversationStartDto } from '@octopus/shared/protocol';

/**
 * Resolves allocated Session identities even before their catalog rows have been published.
 */
export function conversationStartReceiptOptions(workspaceId: string, sessionId: string) {
  return queryOptions({
    queryKey: ['conversation-start-receipt', workspaceId, sessionId],
    queryFn: ({ signal }) =>
      request<ConversationStartDto | null>({
        url: `/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/start-receipt`,
        signal,
      }),
    retry: false,
    refetchOnMount: 'always',
  });
}
