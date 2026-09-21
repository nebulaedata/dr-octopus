/**
 * @author Codex
 * @description Provides explicit, non-retrying Server configuration and restart requests.
 */
import { request } from '../utils/request';
import type {
  RestartOperationDto,
  RestartServerBody,
  SaveServerSettingsResponse,
  ServerSettingsDto,
  UpdateEnvironmentBody,
} from '@octopus/shared/protocol';

/**
 * Reads actual runtime and next-start configuration without caching HTTP responses.
 */
export function getServerSettings(signal?: AbortSignal) {
  return request<ServerSettingsDto>({ url: '/settings/server', signal });
}
/**
 * Saves overrides and optionally confirms this exact patch's listener exposure.
 */
export function saveServerSettings(data: UpdateEnvironmentBody, confirmed = false) {
  return request<SaveServerSettingsResponse>({
    url: '/settings/server',
    method: 'PATCH',
    data,
    headers: confirmed ? { 'X-Octopus-Confirm-Exposure': 'true' } : {},
  });
}
/**
 * Submits a manually confirmed restart with a stable attempt identity.
 */
export function restartServer(data: RestartServerBody, key: string) {
  return request<{ operation: RestartOperationDto }>({
    url: '/settings/server/restart',
    method: 'POST',
    data,
    headers: { 'Idempotency-Key': key },
  });
}
/**
 * Resolves only the accepted operation; a missing record must never trigger another restart.
 */
export function getServerRestartOperation(id: string, signal?: AbortSignal) {
  return request<{ operation: RestartOperationDto }>({
    url: `/settings/server/restart-operations/${encodeURIComponent(id)}`,
    signal,
  });
}
