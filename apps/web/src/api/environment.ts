/**
 * @author Codex
 * @description Provides typed environment Settings reads and revision-checked edits.
 */
import { request } from '../utils/request';
import type {
  EnvironmentScope,
  EnvironmentSettingsDto,
  UpdateEnvironmentBody,
} from '@octopus/shared/protocol';

/**
 * Fetches redacted values and their winning configuration sources for one scope.
 */
export function getEnvironmentSettings(scope: EnvironmentScope, signal?: AbortSignal) {
  return request<EnvironmentSettingsDto>({ url: `/settings/environment/${scope}`, method: 'GET', signal });
}

/**
 * Updates file overrides only, leaving active processes unchanged.
 */
export function updateEnvironmentSettings(
  scope: EnvironmentScope,
  data: UpdateEnvironmentBody,
  confirmed = false
) {
  return request<EnvironmentSettingsDto>({
    url: `/settings/environment/${scope}`,
    method: 'PATCH',
    data,
    headers: confirmed ? { 'X-Octopus-Confirm-Exposure': 'true' } : {},
  });
}
