/**
 * @author Codex
 * @description Browser access to redacted Jev settings and explicit connectivity checks.
 */
import { request } from '@/utils/request';
import type {
  JevCredentialUpdate,
  JevProbeResult,
  JevSettingsSnapshot,
  JevSettingsUpdate,
} from '@octopus/shared/protocol';
/**
 * Retrieve settings without returning the saved API key.
 */
export function getJevSettings(signal?: AbortSignal): Promise<JevSettingsSnapshot> {
  return request({ url: '/settings/jev', signal });
}
/**
 * Save a revision-checked model edit.
 */
export function saveJevSettings(data: JevSettingsUpdate): Promise<JevSettingsSnapshot> {
  return request({ url: '/settings/jev', method: 'PUT', data });
}
/**
 * Write TYPESAFE_API_KEY to the Agent environment; null removes only the saved value.
 */
export function saveJevCredential(data: JevCredentialUpdate): Promise<JevSettingsSnapshot> {
  return request({ url: '/settings/jev/credential', method: 'PATCH', data });
}
/**
 * Test the saved connection with synthetic text without invoking any consumer feature.
 */
export function probeJev(): Promise<JevProbeResult> {
  return request({ url: '/settings/jev/probe', method: 'POST' });
}

/**
 * List selectable model IDs using credentials kept on the Server.
 */
export function getJevModels(signal?: AbortSignal): Promise<string[]> {
  return request({ url: '/settings/jev/models', signal });
}
