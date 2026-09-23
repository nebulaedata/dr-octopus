/**
 * @author Codex
 * @description Adapts onboarding runtime discovery into independent Server provider configuration.
 */
import { randomUUID } from 'node:crypto';
import { createOnboardingService } from '@octopus/agent';
import { readLocalProviders, saveLocalProvider } from './local-provider-repository.js';
import { ApplicationError } from '../errors/application-error.js';
import type {
  ConfigureLocalProviderBody,
  CreateLocalProviderBody,
  LocalModelDetectionDto,
} from '@octopus/shared/protocol';
import type { PiSettingsProvider } from './types.js';

/**
 * Owns draft providers and delegates protocol-specific detection to the existing onboarding SDK.
 */
export class LocalProviderStore {
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
   * Adds persisted drafts and local configuration to the Pi catalog without inventing available models.
   */
  public async project(providers: PiSettingsProvider[]): Promise<PiSettingsProvider[]> {
    const records = await readLocalProviders(this.path);
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
        },
      });
    }
    return [...result.values()];
  }
  /**
   * Saves a named draft without contacting a runtime or changing the default model.
   */
  public async create(input: CreateLocalProviderBody): Promise<string> {
    const runtime = this.onboarding.getLocalRuntimes().find((runtime) => runtime.id === input.runtime)!;
    const id = `octopus-${input.runtime}-${randomUUID()}`;
    await saveLocalProvider(this.path, id, { ...input, baseUrl: runtime.defaultBaseUrl });
    return id;
  }
  /**
   * Detects models at a normalized runtime address; local means the Server's host.
   */
  public async detect(id: string, baseUrl: string): Promise<LocalModelDetectionDto> {
    const record = await this.require(id);
    return this.onboarding.detectLocalRuntime({
      runtime: record.runtime,
      baseUrl: this.normalize(record.runtime, baseUrl),
    });
  }
  /**
   * Revalidates the selected model against the endpoint before atomically saving Pi configuration.
   */
  public async configure(id: string, input: ConfigureLocalProviderBody): Promise<boolean> {
    const record = await this.require(id);
    const baseUrl = this.normalize(record.runtime, input.baseUrl);
    const detection = await this.detect(id, baseUrl);
    if (!detection.reachable) {
      throw new ApplicationError(
        'LOCAL_RUNTIME_OFFLINE',
        '无法连接本地模型服务，请检查服务已启动且地址正确。',
        { statusCode: 422 }
      );
    }
    if (!detection.models.some((model) => model.id === input.modelId)) {
      throw new ApplicationError('LOCAL_MODEL_NOT_FOUND', '所选模型已不可用，请重新检测模型。', {
        statusCode: 422,
      });
    }
    return saveLocalProvider(this.path, id, { ...record, baseUrl, modelId: input.modelId });
  }
  /**
   * Requires metadata ownership before allowing local provider mutations.
   */
  private async require(id: string) {
    const record = (await readLocalProviders(this.path))[id];
    if (!record) {
      throw new ApplicationError('LOCAL_PROVIDER_NOT_FOUND', '该提供商不是可配置的本地模型服务。', {
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
