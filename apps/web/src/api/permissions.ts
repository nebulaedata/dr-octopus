/**
 * @author Codex
 * @description Provides typed permission Settings reads and revision-checked overlay updates.
 */
import { request } from '../utils/request';
import type { PermissionSettingsSnapshot, PermissionSettingsUpdate } from '@octopus/shared/protocol';

/**
 * Read a global or registered workspace configuration preview.
 */
export function getPermissionSettings(workspaceId?: string, signal?: AbortSignal) {
  return request<PermissionSettingsSnapshot>({
    url: '/settings/permissions',
    method: 'GET',
    params: { workspaceId },
    signal,
  });
}

/**
 * Replace this scope's overlay while retaining all inherited configuration.
 */
export function updatePermissionSettings(data: PermissionSettingsUpdate, workspaceId?: string) {
  return request<PermissionSettingsSnapshot>({
    url: '/settings/permissions',
    method: 'PUT',
    params: { workspaceId },
    data,
  });
}
