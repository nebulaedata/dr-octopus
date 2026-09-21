/**
 * @author Codex
 * @description Defines invalidation hints for business data, independent of Conversation transport.
 */
export interface DataChange {
  resource: 'sessions' | 'notifications' | 'scheduler';
  workspaceId?: string;
}
