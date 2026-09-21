/**
 * @author Codex
 * @description Exposes Memory Assistant persistence without leaking browser storage into feature modules.
 */

export {
  initialAssistantPosition,
  readStoredAssistantPosition,
  writeStoredAssistantPosition,
} from './position-storage';
export type { MemoryAssistantPosition, MemoryAssistantViewport } from './position-storage';
