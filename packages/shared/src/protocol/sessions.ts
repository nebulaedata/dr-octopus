/**
 * @author Codex
 * @description Defines shared Session identity, preferences, and runtime projection contracts.
 */

import type { RuntimeProjectionState, ThinkingLevel } from './runtime.js';
import type { SessionRuntimeControlDto } from './session-control.js';

export interface SessionPreferencesDto {
  thinkingLevel?: ThinkingLevel;
  steeringMode: 'all' | 'one-at-a-time';
  followUpMode: 'all' | 'one-at-a-time';
  autoCompactionEnabled: boolean;
  autoRetryEnabled: boolean;
}

export interface DeleteSessionOptionsDto {
  deleteFiles?: boolean;
}

export const MAX_PINNED_SESSIONS = 3;

export interface SessionDto {
  runtimeControl?: SessionRuntimeControlDto;
  notificationVersion?: number;
  readVersion?: number;
  execution?: { taskId: string; runId: string; status: string };
  /**
   * True only for an in-memory home draft that has not yet entered the Session catalog.
   */
  isDraft?: boolean;
  id: string;
  workspaceId: string;
  title: string;
  provider?: string;
  model?: string;
  agentSessionPath?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
  lastMessageAt?: string;
  pinnedAt?: string;
  runtime?: SessionRuntimeDto;
  preferences: SessionPreferencesDto;
}

export interface SessionRuntimeDto {
  runtimeId: string;
  epoch: number;
  workspaceId: string;
  sessionId: string;
  state: RuntimeProjectionState;
  lastActiveAt: number;
}
