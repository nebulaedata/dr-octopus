/**
 * @author Codex
 * @description Defines the Sessions business-service composition contract.
 */

import type { PiSessionRepository, SessionRuntimeCoordinator } from '../../lib/runtime/index.js';
import type { MessageFeedbackRepository } from './message-feedback.repository.js';
import type { SessionsRepository } from './sessions.repository.js';
import type { WorkspaceService } from '@octopus/agent';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';

export interface SessionsServiceOptions {
  runtime?: SessionRuntimeCoordinator;
  sessionsRepository?: SessionsRepository;
  messageFeedbackRepository?: MessageFeedbackRepository;
  workspaceService: WorkspaceService;
  piSessionsRepository?: PiSessionRepository;
  createSessionId?: () => string;
  listMessageAttachments?: (sessionId: string) => Map<string, MessageAttachmentDto[]>;
}
