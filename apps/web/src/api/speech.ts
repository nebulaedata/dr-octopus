/**
 * @author Codex
 * @description Transports redacted ASR settings and cancellable binary audio to the Server.
 */
import { request } from '@/utils/request';
import type {
  SpeechSettingsDto,
  SpeechSettingsUpdate,
  SpeechTranscriptionDto,
} from '@octopus/shared/protocol';

/**
 * Reads current speech configuration without credentials.
 */
export function getSpeechSettings(signal?: AbortSignal) {
  return request<SpeechSettingsDto>({ url: '/settings/speech', signal });
}
/**
 * Commits one revision-checked settings change.
 */
export function saveSpeechSettings(data: SpeechSettingsUpdate) {
  return request<SpeechSettingsDto>({ url: '/settings/speech', method: 'PUT', data });
}
/**
 * Uploads audio once; cancellation stops transport and no retries can duplicate ASR charges.
 */
export function transcribeSpeech(audio: Blob, signal: AbortSignal) {
  return request<SpeechTranscriptionDto>({
    url: '/speech/transcriptions',
    method: 'POST',
    data: audio,
    signal,
    timeout: 65_000,
    headers: { 'Content-Type': audio.type },
  });
}
