/**
 * @author Codex
 * @description Centralizes current Session DTO projection and user metadata normalization.
 */
import { isThinkingLevel } from '@octopus/shared/protocol';
import type { SessionDto, SessionPreferencesDto, SessionRuntimeDto } from '@octopus/shared/protocol';
import type { SessionRow } from '../../db/schema.js';
import type { SessionRuntimeBinding } from '../../infrastructure/runtime/index.js';

/**
 * Projects one catalog record onto the current shared Session contract.
 * The legacy contract still includes agentSessionPath pending an ADR-0010 migration.
 *
 * @param row Internal Session catalog record.
 * @returns Browser-safe Session representation.
 */
export function toSessionDto(row: SessionRow): SessionDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    notificationVersion: row.notificationVersion ?? 0,
    readVersion: row.readVersion ?? 0,
    ...(row.execution ? { execution: row.execution } : {}),
    ...(row.provider === null ? {} : { provider: row.provider }),
    ...(row.model === null ? {} : { model: row.model }),
    agentSessionPath: row.execution ? '' : row.agentSessionPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.lastActiveAt === null ? {} : { lastActiveAt: row.lastActiveAt }),
    ...(row.lastMessageAt === null ? {} : { lastMessageAt: row.lastMessageAt }),
    ...(row.pinnedAt === null ? {} : { pinnedAt: row.pinnedAt }),
    preferences: {
      ...(isThinkingLevel(row.thinkingLevel) ? { thinkingLevel: row.thinkingLevel } : {}),
      steeringMode: row.steeringMode as SessionPreferencesDto['steeringMode'],
      followUpMode: row.followUpMode as SessionPreferencesDto['followUpMode'],
      autoCompactionEnabled: row.autoCompactionEnabled,
      autoRetryEnabled: row.autoRetryEnabled,
    },
  };
}

/**
 * Removes Server-only runtime fields before publishing a runtime binding.
 *
 * @param binding Internal immutable runtime binding.
 * @returns Browser-safe runtime representation.
 */
export function toRuntimeDto(binding: SessionRuntimeBinding): SessionRuntimeDto {
  return {
    runtimeId: binding.runtimeId,
    epoch: binding.epoch,
    workspaceId: binding.workspaceId,
    sessionId: binding.sessionId,
    state: binding.state,
    lastActiveAt: binding.lastActiveAt,
  };
}

/**
 * Normalizes a user-provided Session title to the catalog invariant.
 *
 * @param title Untrusted display title.
 * @returns A non-empty title capped at the catalog limit.
 */
export function normalizeSessionTitle(title: string): string {
  const normalized = title.trim().slice(0, 200);
  return normalized.length === 0 ? 'New session' : normalized;
}
