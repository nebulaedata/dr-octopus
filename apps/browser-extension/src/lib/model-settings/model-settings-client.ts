/**
 * @author Codex
 * @description Binds a single settings request to an extension-page port so closing the page cancels remote work.
 */
import { browser } from 'wxt/browser';
import type { ModelSettingsRequest } from './model-settings-messages';

/**
 * Resolves one safe background result; abort/disconnect never implies success and never retries.
 */
export function modelSettingsRequest<T>(request: ModelSettingsRequest, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('MODEL_CANCELLED'));
      return;
    }
    const port = browser.runtime.connect({ name: 'octopus-model-settings' });
    let settled = false;
    /**
     * Releases both listeners and the owned port exactly once.
     */
    function finish(error?: string, value?: T) {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', abort);
      port.onDisconnect.removeListener(disconnected);
      port.onMessage.removeListener(message);
      port.disconnect();
      if (error) {
        reject(new Error(error));
      } else {
        resolve(value as T);
      }
    }
    /**
     * Cancels only this request.
     */
    function abort() {
      finish('MODEL_CANCELLED');
    }
    /**
     * Reports lost coordination without replaying a potentially billable request.
     */
    function disconnected() {
      finish('MODEL_INTERRUPTED');
    }
    /**
     * Accepts a single response from the connected extension background.
     */
    function message(reply: { ok?: boolean; value?: T; error?: string }) {
      finish(reply?.ok ? undefined : (reply?.error ?? 'MODEL_FAILED'), reply?.value);
    }
    port.onMessage.addListener(message);
    port.onDisconnect.addListener(disconnected);
    signal.addEventListener('abort', abort, { once: true });
    try {
      port.postMessage(request);
    } catch {
      finish('MODEL_INTERRUPTED');
    }
  });
}
