/**
 * @author Codex
 * @description Defines invalidation hints for business data, independent of Conversation transport.
 */
export const DATA_CHANGE_RESOURCES = [
  'sessions',
  'notifications',
  'scheduler',
  'model-config',
  'conversation-starts',
  'provider-auth',
  'attachments',
  'memory',
  'knowledge',
  'server-lifecycle',
] as const;

export interface DataChange {
  resource: (typeof DATA_CHANGE_RESOURCES)[number];
  workspaceId?: string;
}
