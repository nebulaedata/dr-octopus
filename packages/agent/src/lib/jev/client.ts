/**
 * @author Codex
 * @description Adapts the official TypeSafe SDK to bounded, secret-safe Choice evaluations.
 */
import { APITimeoutError, TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { JevError } from './settings.js';
import { jevSettingsSchema } from '@octopus/shared/protocol';
import type { EntryType, Fetch } from '@typesafe-ai/sdk';
import type { JevSettings } from '@octopus/shared/protocol';

export interface JevChoiceQuestion {
  instructions: string;
  criteria: Record<string, string>;
}
export interface JevChoiceResult {
  model: string;
  choice: string;
  probabilities: Record<string, number>;
  latencyMs: number;
}

/**
 * Let the SDK own authentication, serialization, response parsing, timeouts and cancellation.
 * Disable retries and logging so this optional evaluation stays bounded and does not expose evidence.
 */
export async function evaluateJevChoice(
  config: JevSettings & { timeoutMs: number },
  state: EntryType,
  question: JevChoiceQuestion,
  options: { signal?: AbortSignal; fetch?: Fetch; apiKey?: string } = {}
): Promise<JevChoiceResult> {
  const { signal } = options;
  const client = createJevClient(config, options);
  const started = Date.now();
  try {
    const result = await client.systemOne(
      {
        state,
        questions: { decision: choice(question.instructions, question.criteria) },
      },
      { signal }
    );
    signal?.throwIfAborted();
    const answer = result?.answers?.decision;
    const names = Object.keys(question.criteria);
    if (
      typeof result?.model !== 'string' ||
      answer?.type !== 'choice' ||
      typeof answer.choice !== 'string' ||
      !names.includes(answer.choice) ||
      !answer.probabilities ||
      Object.keys(answer.probabilities).length !== names.length
    ) {
      throw new JevError('JEV_RESPONSE_INVALID');
    }
    const probabilities: Record<string, number> = {};
    const selected = answer.choice;
    for (const name of names) {
      const value = answer.probabilities[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new JevError('JEV_RESPONSE_INVALID');
      }
      probabilities[name] = value;
    }
    const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
    if (
      Math.abs(sum - 1) > names.length * 0.005 + 0.000001 ||
      Object.values(probabilities).some((p) => p > probabilities[selected]! + 0.001)
    ) {
      throw new JevError('JEV_RESPONSE_INVALID');
    }
    if (!['jev-latest', 'jev-preview'].includes(config.model) && result.model !== config.model) {
      throw new JevError('JEV_RESPONSE_INVALID');
    }
    return { model: result.model, choice: selected, probabilities, latencyMs: Date.now() - started };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof APITimeoutError) {
      throw new JevError('JEV_TIMEOUT');
    }
    if (error instanceof JevError) {
      throw error;
    }
    // SDK error bodies can contain private text; only a safe code crosses this boundary.
    throw new JevError('JEV_REQUEST_FAILED');
  }
}

/**
 * List account-visible model IDs through the official SDK without exposing provider metadata or credentials.
 */
export async function listJevModels(
  options: { signal?: AbortSignal; fetch?: Fetch; apiKey?: string } = {}
): Promise<string[]> {
  const client = createJevClient({ timeoutMs: 5000 }, options);
  try {
    const models = await client.models.list({ signal: options.signal });
    options.signal?.throwIfAborted();
    if (!Array.isArray(models)) {
      throw new JevError('JEV_RESPONSE_INVALID');
    }
    const names = models.map((model) => {
      const parsed = jevSettingsSchema.shape.model.safeParse(model?.name);
      if (!parsed.success || typeof model?.name !== 'string') {
        throw new JevError('JEV_RESPONSE_INVALID');
      }
      return parsed.data;
    });
    return [...new Set(names)];
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof APITimeoutError) {
      throw new JevError('JEV_TIMEOUT');
    }
    if (error instanceof JevError) {
      throw error;
    }
    throw new JevError('JEV_REQUEST_FAILED');
  }
}

/**
 * Share authentication and bounded, quiet transport policy between evaluations and model discovery.
 */
function createJevClient(
  config: { model?: string; timeoutMs: number },
  options: { signal?: AbortSignal; fetch?: Fetch; apiKey?: string }
): TypeSafeClient {
  const { signal } = options;
  const fetcher = options.fetch ?? fetch;
  const apiKey = (options.apiKey ?? process.env.TYPESAFE_API_KEY)?.trim();
  signal?.throwIfAborted();
  if (!apiKey?.trim()) {
    throw new JevError('JEV_KEY_REQUIRED');
  }
  return new TypeSafeClient({
    apiKey,
    baseURL: 'https://api.typesafe.ai',
    defaultModel: config.model,
    timeout: config.timeoutMs,
    retry: { maxRetries: 0 },
    logLevel: 'off',
    fetch: (input, init) => fetcher(input, { ...init, redirect: 'error' }),
  });
}
