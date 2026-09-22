/**
 * @author Codex
 * @description Provides runtime-independent model discovery and idempotent first-message HTTP operations.
 */
import { request } from '@/utils/request';
import type {
  ConversationStartDto,
  ConversationStartInput,
  DefaultModelDto,
  ModelDto,
} from '@octopus/shared/protocol';

/**
 * Reads available models without activating an Agent.
 */
export function getConversationModels(
  signal?: AbortSignal
): Promise<{ models: ModelDto[]; defaults: DefaultModelDto }> {
  return request({ url: '/conversation-models', signal });
}
/**
 * Reuses a saved submission identity when a response is lost.
 */
export function startConversation(
  workspaceId: string,
  data: ConversationStartInput
): Promise<ConversationStartDto> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/conversation-starts`,
    method: 'POST',
    data,
  });
}
/**
 * Reads authoritative submission status after navigation, refresh or transport failure.
 */
export function getConversationStart(workspaceId: string, id: string): Promise<ConversationStartDto> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/conversation-starts/${encodeURIComponent(id)}`,
  });
}
/**
 * Cancels only preparation; accepted operations return their actual status.
 */
export function cancelConversationStart(workspaceId: string, id: string): Promise<ConversationStartDto> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/conversation-starts/${encodeURIComponent(id)}`,
    method: 'DELETE',
  });
}
