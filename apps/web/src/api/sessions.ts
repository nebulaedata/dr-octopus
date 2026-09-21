/**
 * @author Codex
 * @description Defines HTTP operations for Session resources and projections.
 */

import { request } from '../utils/request';
import { v4 as uuidv4 } from 'uuid';
import type {
  DeleteSessionOptionsDto,
  SessionDto,
  SessionBootstrapDto,
  SessionPreferencesDto,
  SessionSnapshotDto,
  SessionHistoryDto,
  MessageFeedbackDto,
  RestartSessionBody,
} from '@octopus/shared/protocol';

/**
 * Reads persisted history independently of runtime activation.
 */
export function getSessionHistory(
  workspaceId: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionHistoryDto> {
  return request({ url: `${sessionPath(workspaceId, sessionId)}/history`, method: 'GET', signal });
}

const SESSION_CREATION_TIMEOUT_MS = 45_000;

/**
 * Builds an encoded Workspace resource path.
 */
const workspacePath = (workspaceId: string): string => {
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
};

/**
 * Builds an encoded Session resource path.
 */
const sessionPath = (workspaceId: string, sessionId: string): string => {
  return `${workspacePath(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`;
};

/**
 * Creates one retry-stable identity header for a logical HTTP mutation call.
 */
const mutationHeaders = (): Record<string, string> => ({ 'Idempotency-Key': uuidv4() });

/**
 * Restarts one exact runtime generation without cancelling accepted work on transport timeout.
 */
export function restartSession(
  workspaceId: string,
  sessionId: string,
  body: RestartSessionBody
): Promise<SessionDto> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/restart`,
    method: 'POST',
    data: body,
    headers: mutationHeaders(),
    timeout: 65_000,
  });
}

/**
 * Retrieves the Session catalog for one Workspace.
 */
export function getSessions(workspaceId: string, signal?: AbortSignal): Promise<SessionDto[]> {
  return request({
    url: `${workspacePath(workspaceId)}/sessions`,
    method: 'GET',
    signal,
  });
}

/**
 * Retrieves the complete fenced Session resources required before Composer interaction.
 */
export function getSessionBootstrap(
  workspaceId: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionBootstrapDto> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/bootstrap`,
    method: 'GET',
    signal,
  });
}

/**
 * Retrieves the authoritative projection used to hydrate a Session runtime.
 */
export function getSessionSnapshot(
  workspaceId: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionSnapshotDto> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/snapshot`,
    method: 'GET',
    signal,
  });
}

/**
 * Creates a Session in the selected Workspace.
 */
export function createSession(workspaceId: string): Promise<SessionDto> {
  return request({
    url: `${workspacePath(workspaceId)}/sessions`,
    method: 'POST',
    headers: mutationHeaders(),
    data: {},
    timeout: SESSION_CREATION_TIMEOUT_MS,
  });
}

/**
 * Persists a Web Session display title.
 */
export function renameSession(session: SessionDto, title: string): Promise<SessionDto> {
  return request({
    url: sessionPath(session.workspaceId, session.id),
    method: 'PATCH',
    headers: mutationHeaders(),
    data: { title },
  });
}

/**
 * Persists whether a Session is pinned at the top of its Workspace catalog.
 */
export function setSessionPinned(session: SessionDto, pinned: boolean): Promise<SessionDto> {
  return request({
    url: `${sessionPath(session.workspaceId, session.id)}/pinned`,
    method: 'PATCH',
    headers: mutationHeaders(),
    data: { pinned },
  });
}

/**
 * Deletes one Session from its Workspace.
 */
export function deleteSession(session: SessionDto, options?: DeleteSessionOptionsDto): Promise<void> {
  return request({
    url: sessionPath(session.workspaceId, session.id),
    method: 'DELETE',
    headers: mutationHeaders(),
    data: options ?? {},
  });
}

/**
 * Derives a Session by cloning its current leaf.
 */
export function cloneSession(workspaceId: string, sessionId: string): Promise<{ session: SessionDto }> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/clone`,
    method: 'POST',
    headers: mutationHeaders(),
  });
}

/**
 * Derives a Session from a specific history entry.
 */
export function forkSession(
  workspaceId: string,
  sessionId: string,
  entryId: string
): Promise<{ session: SessionDto; prefill?: string }> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/fork`,
    method: 'POST',
    headers: mutationHeaders(),
    data: { entryId },
  });
}

/**
 * Retrieves the active Session history leaf.
 */
export function getSessionTree(
  workspaceId: string,
  sessionId: string
): Promise<{ tree: unknown; leafId: string | null }> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/tree`,
    method: 'GET',
  });
}

/**
 * Persists behavior preferences for one Session.
 */
export function updateSessionPreferences(
  workspaceId: string,
  sessionId: string,
  preferences: Partial<SessionPreferencesDto>
): Promise<SessionDto> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/preferences`,
    method: 'PATCH',
    headers: mutationHeaders(),
    data: preferences,
  });
}

/**
 * Persists user feedback for one Session history entry.
 */
export function submitMessageFeedback(
  workspaceId: string,
  sessionId: string,
  entryId: string,
  rating: 'up' | 'down'
): Promise<MessageFeedbackDto> {
  return request({
    url: `${sessionPath(workspaceId, sessionId)}/feedback`,
    method: 'POST',
    headers: mutationHeaders(),
    data: { entryId, rating },
  });
}

/**
 * Returns the same-origin HTML export URL without issuing a request.
 */
export function getSessionExportUrl(workspaceId: string, sessionId: string): string {
  return `/api${sessionPath(workspaceId, sessionId)}/export`;
}

/**
 * Prepares one unpublished runtime; repeated calls reuse the same browser-owned draft identity.
 */
export function prepareSessionDraft(workspaceId: string, draftId: string): Promise<SessionDto> {
  return request({
    url: `${workspacePath(workspaceId)}/session-drafts`,
    method: 'POST',
    headers: mutationHeaders(),
    data: { draftId },
    timeout: SESSION_CREATION_TIMEOUT_MS,
  });
}

/**
 * Publishes the warmed identity immediately before sending its first user message.
 */
export function publishSessionDraft(session: SessionDto, title: string): Promise<SessionDto> {
  return request({
    url: `${workspacePath(session.workspaceId)}/session-drafts/${encodeURIComponent(session.id)}/publish`,
    method: 'POST',
    headers: mutationHeaders(),
    data: { title },
  });
}
