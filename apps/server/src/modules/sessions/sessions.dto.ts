/**
 * @author Codex
 * @description Defines request data contracts accepted by Session HTTP endpoints.
 */
import type { DeleteSessionOptionsDto, SessionPreferencesDto } from '@octopus/shared/protocol';

export interface WorkspaceParams {
  workspaceId: string;
}

export interface WorkspaceSessionParams extends WorkspaceParams {
  sessionId: string;
}

export interface ListSessionsQuery {
  search?: string;
}

export interface CreateSessionBody {
  title?: string;
}

export interface RenameSessionBody {
  title: string;
}

export interface UpdateSessionPinnedBody {
  pinned: boolean;
}

export type DeleteSessionBody = DeleteSessionOptionsDto;

export interface ListSessionEntriesQuery {
  since?: string;
}

export interface ForkSessionBody {
  entryId: string;
}

export interface SubmitMessageFeedbackBody {
  entryId: string;
  rating: 'up' | 'down';
}

export type UpdateSessionPreferencesBody = Partial<SessionPreferencesDto>;
