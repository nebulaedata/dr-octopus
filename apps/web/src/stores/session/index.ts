/**
 * @author Codex
 * @description Session store 统一导出入口。
 */

export { createSessionStore } from './store';
export {
  persistAttachmentDraft,
  restoreAttachmentDraft,
} from '@/stores/session/utils/attachments/draft-storage';
export type {
  AutoRetryProjection,
  CompactionProjection,
  ComposerAttachmentViewModel,
  ContentBlock,
  ExtensionNotificationProjection,
  MessageProjection,
  SessionActions,
  SessionProjectionState,
  SessionStoreApi,
  SessionStoreRegistryOptions,
  ToolProjection,
  ToolContentBlock,
  TranscriptItem,
} from './type';
export { SessionStoreRegistry, sessionStores } from './registry';
export { selectTurnElapsedMs } from './utils/elapsed-time';

export {
  registerAttachmentUploadTask,
  unregisterAttachmentUploadTask,
  abortAttachmentUploadTask,
} from '@/stores/session/utils/attachments/upload-tasks';

export { formatTokenCount, selectTurnTokenUsage } from './utils/token-usage';
