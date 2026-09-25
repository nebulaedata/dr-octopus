/**
 * @author Codex
 * @description Manages user-added local and remote model services through one Server-owned configuration flow.
 */
import { randomUUID } from 'node:crypto';
import { createOnboardingService } from '@octopus/agent';
import {
  deleteCustomProvider,
  readCustomProviderMetadata,
  readCustomProviders,
  saveCustomProvider,
} from './custom-provider-repository.js';
import { ApplicationError } from '../errors/application-error.js';
import type {
  ConfigureCustomProviderBody,
  CreateCustomProviderBody,
  CustomProviderModelDetectionDto,
  CustomProviderTypeDto,
} from '@octopus/shared/protocol';
import type { PiSettingsProvider } from './types.js';

/**
 * Owns draft providers and delegates protocol-specific detection to the existing onboarding SDK.
 */
export class CustomProviderStore {
  readonly onboarding: ReturnType<typeof createOnboardingService>;
  /**
   * Binds discovery and persistence to the Server's explicit Pi directory.
   */
  public constructor(
    private readonly path: string,
    agentDir: string
  ) {
    this.onboarding = createOnboardingService({ agentDir });
  }
  /**
   * Adds persisted drafts and custom configuration to the Pi catalog without inventing available models.
   */
  public async project(providers: PiSettingsProvider[]): Promise<PiSettingsProvider[]> {
    const { records, imageGeneration } = await readCustomProviderMetadata(this.path);
    const result = new Map(providers.map((provider) => [provider.id, provider]));
    for (const [id, record] of Object.entries(records)) {
      const existing = result.get(id);
      result.set(id, {
        ...(existing ?? {
          id,
          provenance: 'models_json',
          auth: { configured: false, methods: [] },
          models: [],
          refreshable: true,
          endpointOwned: true,
        }),
        name: record.name,
        baseUrl: record.baseUrl,
        local: {
          runtime: record.runtime,
          baseUrl: record.baseUrl,
          ...(record.modelId ? { modelId: record.modelId } : {}),
          ...(record.api ? { api: record.api } : {}),
        },
      });
    }
    for (const [id, marked] of Object.entries(imageGeneration)) {
      const provider = result.get(id);
      if (provider) {
        result.set(id, {
          ...provider,
          models: provider.models.map((model) => ({
            ...model,
            imageGeneration: marked[model.id]?.imageGeneration ?? model.imageGeneration,
            interfaces: marked[model.id]?.interfaces ?? model.interfaces ?? ['chat'],
          })),
        });
      }
    }
    return [...result.values()];
  }
  /**
   * Saves a named draft without contacting a runtime or changing the default model.
   */
  public async create(input: CreateCustomProviderBody): Promise<string> {
    const runtime = this.getRuntimes().find((runtime) => runtime.id === input.runtime)!;
    const id = `octopus-${input.runtime}-${randomUUID()}`;
    await saveCustomProvider(this.path, id, { ...input, baseUrl: runtime.defaultBaseUrl });
    return id;
  }
  /**
   * Detects models at a normalized runtime address; local means the Server's host.
   */
  public async detect(
    id: string,
    baseUrl: string,
    apiKey?: string
  ): Promise<CustomProviderModelDetectionDto> {
    const record = await this.require(id);
    const normalized = this.normalize(record.runtime, baseUrl);
    const local = ['ollama', 'vllm', 'lmstudio'].includes(record.runtime);
    if (local && !apiKey) {
      return this.onboarding.detectLocalRuntime({
        runtime: record.runtime as 'ollama' | 'vllm' | 'lmstudio',
        baseUrl: normalized,
      });
    }
    if (!apiKey) {
      throw new ApplicationError(
        'MODEL_PROVIDER_API_KEY_REQUIRED',
        'An API Key is required to retrieve this provider’s models.',
        { statusCode: 422 }
      );
    }
    const suffix = record.runtime === 'ollama' ? 'api/tags' : 'models';
    const url = `${normalized.replace(/\/+$/, '')}/${suffix}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401 || response.status === 403) {
        throw new ApplicationError(
          'MODEL_DISCOVERY_AUTH_FAILED',
          'The API Key is invalid or cannot list models for this provider.',
          { statusCode: 422 }
        );
      }
      if (!response.ok) {
        throw new ApplicationError(
          'MODEL_DISCOVERY_FAILED',
          `The provider rejected model discovery (HTTP ${response.status}).`,
          { statusCode: 502 }
        );
      }
      const payload = await readModelList(response);
      const rows = record.runtime === 'ollama' ? payload.models : payload.data;
      if (!Array.isArray(rows)) {
        throw new ApplicationError(
          'MODEL_DISCOVERY_INVALID_RESPONSE',
          'The provider returned an invalid model list.',
          { statusCode: 502 }
        );
      }
      const models = new Map<string, { id: string; name?: string }>();
      for (const row of rows.slice(0, 2000)) {
        if (!row || typeof row !== 'object') {
          continue;
        }
        const candidate = row as Record<string, unknown>;
        const id = record.runtime === 'ollama' ? candidate.name : candidate.id;
        if (typeof id !== 'string' || !id || id.length > 512) {
          continue;
        }
        const name = typeof candidate.name === 'string' ? candidate.name : undefined;
        models.set(id, { id, ...(name ? { name } : {}) });
      }
      return { reachable: true, models: [...models.values()] };
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      return { reachable: false, models: [] };
    }
  }
  /**
   * Retrieves and persists the provider's full model catalog and endpoint configuration.
   */
  public async configure(
    id: string,
    input: ConfigureCustomProviderBody,
    discoveryKey?: string
  ): Promise<boolean> {
    const record = await this.require(id);
    const baseUrl = this.normalize(record.runtime, input.baseUrl);
    const detection = await this.detect(id, baseUrl, discoveryKey);
    if (!detection.reachable) {
      throw new ApplicationError('LOCAL_RUNTIME_OFFLINE', '无法连接模型服务，请检查服务已启动且地址正确。', {
        statusCode: 422,
      });
    }
    return saveCustomProvider(
      this.path,
      id,
      {
        name: record.name,
        runtime: record.runtime,
        baseUrl,
        api: input.api ?? record.api ?? 'openai-completions',
      },
      detection.models
    );
  }
  /**
   * Lists local and remote types offered by the existing creation form.
   */
  public getRuntimes(): CustomProviderTypeDto[] {
    return [
      ...this.onboarding.getLocalRuntimes(),
      {
        id: 'openai-compatible' as const,
        name: 'OpenAI compatible',
        defaultBaseUrl: '',
      },
      { id: 'mr-token' as const, name: 'Mr.Token', defaultBaseUrl: 'https://api.mrtoken.cn/v1' },
    ];
  }
  /**
   * Removes a Settings-owned service and its model configuration.
   */
  public async delete(id: string): Promise<boolean> {
    await this.require(id);
    return deleteCustomProvider(this.path, id);
  }
  /**
   * Requires metadata ownership before allowing custom provider mutations.
   */
  private async require(id: string) {
    const record = (await readCustomProviders(this.path))[id];
    if (!record) {
      throw new ApplicationError('LOCAL_PROVIDER_NOT_FOUND', '该提供商不是可配置的自定义模型服务。', {
        statusCode: 404,
      });
    }
    return record;
  }
  /**
   * Accepts Ollama's root or OpenAI-compatible address while discovery always uses its native root.
   */
  private normalize(runtime: string, baseUrl: string): string {
    const root = baseUrl.replace(/\/+$/, '');
    return runtime === 'ollama' ? root.replace(/\/v1$/, '') : root;
  }
}

/**
 * Reads one bounded JSON model-list response without retaining unbounded provider output.
 */
async function readModelList(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) {
    throw new ApplicationError('MODEL_DISCOVERY_INVALID_RESPONSE', 'The model list is empty.', {
      statusCode: 502,
    });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > 1_048_576) {
      await reader.cancel();
      throw new ApplicationError('MODEL_DISCOVERY_INVALID_RESPONSE', 'The model list is too large.', {
        statusCode: 502,
      });
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid model list.');
    }
    return payload as Record<string, unknown>;
  } catch {
    throw new ApplicationError('MODEL_DISCOVERY_INVALID_RESPONSE', 'The provider returned invalid JSON.', {
      statusCode: 502,
    });
  }
}
