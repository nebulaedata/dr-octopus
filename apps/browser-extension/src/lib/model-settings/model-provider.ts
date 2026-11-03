/**
 * @author Codex
 * @description Shares bounded provider transport and the minimal model probe without agent session state or recording evidence.
 */
import { generateText, APICallError } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ModelSettings } from './model-settings-messages';

/**
 * Builds identical model transport options for built-in agents and independent connection probes.
 */
export function createModelOptions(settings: ModelSettings, apiKey: string, signal: AbortSignal) {
  const provider = createOpenAICompatible({
    name: 'model-settings',
    supportsStructuredOutputs: false,
    baseURL: settings.baseUrl.replace(/\/$/, ''),
    apiKey,
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: 'error' });
      if (!response.body) {
        return response;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          bytes += chunk.value.length;
          if (bytes > 1024 * 1024) {
            await reader.cancel();
            throw new Error('WORKFLOW_LIMIT');
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
  return {
    model: provider.chatModel(settings.model),
    abortSignal: signal,
    maxRetries: 0,
    // Qwen3.5 Flash defaults to thinking; its structured-output contract targets non-thinking mode.
    // Keep the exception exact: other compatible providers must not receive an unsupported option.
    providerOptions:
      settings.model === 'qwen3.5-flash' ? { 'model-settings': { enable_thinking: false } } : undefined,
  };
}

/**
 * Classifies transport failures without retaining SDK bodies, headers or credential-bearing causes.
 */
export function modelProviderFailure(
  error: unknown
): 'MODEL_AUTH' | 'MODEL_NOT_FOUND' | 'MODEL_CONFIGURATION' | 'MODEL_RATE_LIMIT' | 'MODEL_UNAVAILABLE' {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return 'MODEL_AUTH';
    }
    if (error.statusCode === 404) {
      return 'MODEL_NOT_FOUND';
    }
    if (error.statusCode === 400 || error.statusCode === 422) {
      return 'MODEL_CONFIGURATION';
    }
    if (error.statusCode === 429) {
      return 'MODEL_RATE_LIMIT';
    }
  }
  return 'MODEL_UNAVAILABLE';
}

/**
 * Makes one small generation request; a directory response or empty completion is not a successful probe.
 */
export async function probeModelConnection(
  settings: ModelSettings,
  apiKey: string,
  signal: AbortSignal
): Promise<{ elapsedMs: number }> {
  const started = Date.now();
  let failure: string;
  try {
    const result = await generateText({
      ...createModelOptions(settings, apiKey, signal),
      maxOutputTokens: 32,
      prompt: 'Reply with OK only.',
    });
    if (result.text.trim() && result.finishReason !== 'error') {
      return { elapsedMs: Date.now() - started };
    }
    failure = 'MODEL_EMPTY';
  } catch (error) {
    if (signal.aborted) {
      failure = 'MODEL_CANCELLED';
    } else {
      failure = modelProviderFailure(error);
    }
  }
  // This boundary deliberately drops SDK causes because they can contain credentials and response bodies.
  throw new Error(failure);
}
