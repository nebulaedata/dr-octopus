/**
 * @author Codex
 * @description Sends extension-private recording requests and rejects unsuccessful worker envelopes.
 */
import { browser } from 'wxt/browser';
import type { RecordingRequest, RecordingReply } from './recording-contract';

/**
 * Returns only worker-confirmed data; a failed command never becomes an optimistic UI success.
 */
export async function sendRecordingRequest<T>(request: RecordingRequest): Promise<T> {
  const reply: RecordingReply<T> = await browser.runtime.sendMessage(request);
  if (!reply?.ok) {
    throw new Error(reply?.error ?? 'RECORDING_DELIVERY');
  }
  return reply.value;
}
