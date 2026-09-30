/**
 * @author Codex
 * @description Reads redacted independent image settings and sends revision-fenced updates.
 */
import { request } from '@/utils/request';
import type { ImagegenSettingsDto, ImagegenSettingsUpdate } from '@octopus/shared/protocol';
/**
 * Loads service settings without credentials.
 */
export function getImagegenSettings(signal?: AbortSignal) {
  return request<ImagegenSettingsDto>({ url: '/settings/imagegen', signal });
}
/**
 * Saves one provider or activation choice without modifying conversation defaults.
 */
export function saveImagegenSettings(data: ImagegenSettingsUpdate) {
  return request<ImagegenSettingsDto>({ url: '/settings/imagegen', method: 'PUT', data });
}
