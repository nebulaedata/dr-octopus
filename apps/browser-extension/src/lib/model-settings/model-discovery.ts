/**
 * @author Codex
 * @description Fetches bounded OpenAI-compatible model metadata for the current settings page without persistence or retries.
 */
import { modelSettingsSchema } from './model-settings-messages';

/**
 * Returns unique model IDs; cancellation belongs to the requesting settings page.
 * Provider bodies and credentials are never included in errors.
 */
export async function discoverModels(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal
): Promise<string[]> {
  if (!modelSettingsSchema.shape.baseUrl.safeParse(baseUrl).success || apiKey.length > 4096) {
    throw new Error('MODEL_LIST_INVALID');
  }
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15000);
  try {
    const response = await fetch(baseUrl.replace(/\/+$/, '') + '/models', {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.any([signal, timeout.signal]),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('MODEL_LIST_FAILED');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) {
          throw new Error('MODEL_LIST_LIMIT');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
      throw new Error('MODEL_LIST_INVALID');
    }
    if (body.data.length > 2000) {
      throw new Error('MODEL_LIST_LIMIT');
    }
    const ids = body.data.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('id' in item)) {
        throw new Error('MODEL_LIST_INVALID');
      }
      const result = modelSettingsSchema.shape.model.safeParse(item.id);
      if (!result.success) {
        throw new Error('MODEL_LIST_INVALID');
      }
      return result.data;
    });
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  } catch {
    throw new Error(signal.aborted ? 'MODEL_LIST_CANCELLED' : 'MODEL_LIST_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
