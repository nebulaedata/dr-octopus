/**
 * @author Codex
 * @description Exposes the independent image model settings endpoints.
 */
import { request } from '../utils/request';
import type { ImagegenCandidate, ImagegenConfig, ImagegenSettingsDto } from '@octopus/shared/protocol';

/**
 * Reads the effective image default and its availability.
 */
export function getImagegenSettings(signal?: AbortSignal) {
  return request<ImagegenSettingsDto>({ url: '/settings/imagegen', method: 'GET', signal });
}

/**
 * Lists supported image models with authentication and reference input status.
 */
export function getImagegenCandidates(signal?: AbortSignal) {
  return request<{ candidates: ImagegenCandidate[] }>({
    url: '/settings/imagegen/candidates',
    method: 'GET',
    signal,
  });
}

/**
 * Explicitly saves or clears the image default.
 */
export function saveImagegenSettings(config: ImagegenConfig | null) {
  return request<ImagegenSettingsDto>({
    url: '/settings/imagegen',
    method: config === null ? 'DELETE' : 'PUT',
    ...(config === null ? {} : { data: config }),
  });
}
