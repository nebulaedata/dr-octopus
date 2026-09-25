/**
 * @author Codex
 * @description Maps the Server-owned Pi settings store into opaque-keyed HTTP application use cases.
 */
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { MODEL_CONFIG_ROUTE } from '../../infrastructure/runtime-config/config-routes.js';
import type {
  ConfigureCustomProviderBody,
  CreateCustomProviderBody,
  DefaultModelCandidateDto,
  DefaultModelCandidatesDto,
  DefaultModelDto,
  ModelProviderCatalogDto,
  ModelProviderDetailDto,
  ModelProviderSummaryDto,
  ModelCapability,
  ModelInterface,
  UpdateModelCapabilitiesBody,
} from '@octopus/shared/protocol';
import type { FSWatcher } from 'node:fs';
import type {
  PiSettingsModel,
  PiSettingsProvider,
  ServerPiSettingsStore,
} from '../../infrastructure/pi-settings/index.js';
import type { RuntimeConfigChanges } from '../../infrastructure/runtime-config/runtime-config-changes.js';

/**
 * Creates a stable route key without exposing Provider IDs as route identities.
 *
 * @param value Pi Provider or model identity.
 * @returns Opaque URL-safe key.
 */
function opaqueKey(value: string): string {
  return `p1_${createHash('sha256').update(value).digest('base64url').slice(0, 22)}`;
}

/**
 * Converts an Agent Provider into the public catalog summary.
 *
 * @param provider Agent SDK Provider snapshot.
 * @param defaultModel Current global default pair.
 * @returns HTTP-safe Provider summary.
 */
function toSummary(
  provider: PiSettingsProvider,
  defaultModel: { providerId?: string; modelId?: string }
): ModelProviderSummaryDto {
  const defaultModelId = defaultModel.providerId === provider.id ? defaultModel.modelId : undefined;
  return {
    providerKey: opaqueKey(provider.id),
    providerId: provider.id,
    ...(provider.local ? { local: provider.local } : {}),
    name: provider.name,
    provenance: provider.provenance,
    auth: provider.auth,
    capabilities: {
      refresh: provider.refreshable,
      endpoint: provider.endpointOwned ? 'owned' : 'readonly',
    },
    modelCount: provider.models.length,
    availableModelCount: provider.models.filter((model) => model.available).length,
    ...(defaultModelId === undefined
      ? {}
      : { defaultModelKey: opaqueKey(`${provider.id}\u0000${defaultModelId}`), defaultModelId }),
  };
}

/**
 * Converts a model snapshot into a Provider-scoped public model row.
 *
 * @param provider Provider owning the model.
 * @param model Agent SDK model snapshot.
 * @param defaultModel Current global default pair.
 * @returns HTTP-safe model row.
 */
function toModel(
  provider: PiSettingsProvider,
  model: PiSettingsModel,
  defaultModel: { providerId?: string; modelId?: string }
) {
  const capabilities: ModelCapability[] = [];
  if (model.reasoning) {
    capabilities.push('reasoning');
  }
  if (model.input.includes('image')) {
    capabilities.push('image_input');
  }
  if (model.imageGeneration) {
    capabilities.push('image_generation');
  }
  const interfaces: ModelInterface[] = model.interfaces ?? ['chat'];
  return {
    modelKey: opaqueKey(`${provider.id}\u0000${model.id}`),
    modelId: model.id,
    name: model.name,
    api: model.api,
    available: model.available,
    reasoning: model.reasoning,
    input: model.input,
    capabilities,
    interfaces,
    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    isDefault:
      interfaces.includes('chat') &&
      defaultModel.providerId === provider.id &&
      defaultModel.modelId === model.id,
    configuration: model.configuration,
  };
}

/**
 * Owns Settings HTTP application behavior while Pi state remains in the Agent SDK.
 */
export class SettingsService {
  /**
   * Creates the application service.
   *
   * @param piSettings Server-owned Pi settings infrastructure port.
   */
  public constructor(
    private readonly piSettings: ServerPiSettingsStore,
    private readonly modelConfigChanges?: ModelConfigChanges
  ) {}

  /**
   * Lists all Provider summaries from one coherent snapshot.
   *
   * @returns Provider catalog.
   */
  /**
   * Refreshes local Provider snapshots after an effective configuration change.
   */
  public async refreshCatalog(): Promise<void> {
    await this.piSettings.refreshCatalog?.();
  }

  public async listProviders(): Promise<ModelProviderCatalogDto> {
    const [providers, defaultModel] = await Promise.all([
      this.piSettings.listProviders(),
      this.piSettings.getDefaultModel(),
    ]);
    return { providers: providers.map((provider) => toSummary(provider, defaultModel)) };
  }

  /**
   * Lists the types offered by custom provider creation.
   */
  public getCustomProviderTypes() {
    return this.piSettings.getCustomProviderTypes();
  }
  /**
   * Creates a persistent named draft and returns its routable detail.
   */
  public async createCustomProvider(input: CreateCustomProviderBody) {
    const id = await this.piSettings.createCustomProvider(input);
    return this.getProvider(opaqueKey(id));
  }
  /**
   * Resolves the route identity before read-only local model discovery.
   */
  public async detectCustomProvider(key: string, baseUrl: string, apiKey?: string) {
    const provider = await this.requireProvider(key);
    return this.piSettings.detectCustomProvider(provider.id, baseUrl, apiKey);
  }
  /**
   * Resolves an editable custom model before persisting its Pi capability metadata.
   */
  public async updateModelCapabilities(key: string, modelKey: string, input: UpdateModelCapabilitiesBody) {
    const provider = await this.requireProvider(key);
    const model = provider.models.find(
      (candidate) => opaqueKey(`${provider.id}\u0000${candidate.id}`) === modelKey
    );
    if (provider.provenance !== 'models_json' || !model) {
      throw new ApplicationError(
        'MODEL_PROVIDER_CAPABILITY_UNSUPPORTED',
        'Model capabilities are not editable for this provider.',
        { statusCode: 422 }
      );
    }
    const result = await this.piSettings.updateModelCapabilities(provider.id, model.id, input);
    this.#recordConfiguration(result);
    return this.getProvider(key);
  }

  /**
   * Synchronizes all discovered models for a user-added provider without changing the global default pair.
   */
  public async configureCustomProvider(key: string, input: ConfigureCustomProviderBody) {
    const provider = await this.requireProvider(key);
    if (
      provider.local &&
      !['ollama', 'vllm', 'lmstudio'].includes(provider.local.runtime) &&
      !input.apiKey &&
      !provider.auth.configured
    ) {
      throw new ApplicationError(
        'MODEL_PROVIDER_API_KEY_REQUIRED',
        'An API Key is required for this remote model service.',
        { statusCode: 422 }
      );
    }
    const result = await this.piSettings.configureCustomProvider(provider.id, input);
    this.#recordConfiguration(result);
    return this.getProvider(key);
  }

  /**
   * Deletes a Settings-created service unless it owns the current default model.
   */
  public async deleteCustomProvider(key: string) {
    const provider = await this.requireProvider(key);
    if (!provider.local) {
      throw new ApplicationError(
        'MODEL_PROVIDER_CAPABILITY_UNSUPPORTED',
        'This provider cannot be deleted here.',
        { statusCode: 422 }
      );
    }
    const current = await this.piSettings.getDefaultModel();
    if (current.providerId === provider.id) {
      throw new ApplicationError(
        'MODEL_PROVIDER_DEFAULT_IN_USE',
        'Choose another default model before deleting this provider.',
        { statusCode: 409 }
      );
    }
    const result = await this.piSettings.deleteCustomProvider(provider.id);
    this.#recordConfiguration(result);
    return { deleted: true };
  }

  /**
   * Notifies sessions of committed configuration even when catalog synchronization fails.
   */
  #recordConfiguration(result: { changed: boolean; synchronized: boolean }): void {
    if (result.changed) {
      this.modelConfigChanges?.recordCommitted();
    }
    if (!result.synchronized) {
      throw new ApplicationError(
        'MODEL_CONFIG_COMMITTED_UNSYNCED',
        '配置已保存，但模型目录刷新失败；已有会话可手动重启。',
        { statusCode: 502 }
      );
    }
  }

  /**
   * Resolves one Provider from its opaque route identity.
   *
   * @param providerKey Opaque route key.
   * @returns Provider detail or undefined when the current catalog has no match.
   */
  public async getProvider(providerKey: string): Promise<ModelProviderDetailDto | undefined> {
    const [providers, defaultModel] = await Promise.all([
      this.piSettings.listProviders(),
      this.piSettings.getDefaultModel(),
    ]);
    const provider = providers.find((candidate) => opaqueKey(candidate.id) === providerKey);
    if (provider === undefined) {
      return undefined;
    }
    return {
      ...toSummary(provider, defaultModel),
      ...(provider.baseUrl === undefined ? {} : { endpoint: { effectiveBaseUrl: provider.baseUrl } }),
      models: provider.models.map((model) => toModel(provider, model, defaultModel)),
    };
  }

  /**
   * Reads the global default pair and its current availability.
   *
   * @returns Default-model state.
   */
  public async getDefaultModel(): Promise<DefaultModelDto> {
    const [providers, configured] = await Promise.all([
      this.piSettings.listProviders(),
      this.piSettings.getDefaultModel(),
    ]);
    const provider = providers.find((candidate) => candidate.id === configured.providerId);
    const model = provider?.models.find((candidate) => candidate.id === configured.modelId);
    return {
      ...(provider === undefined ? {} : { providerKey: opaqueKey(provider.id), providerId: provider.id }),
      ...(model === undefined
        ? {}
        : {
            modelKey: opaqueKey(`${provider?.id}\u0000${model.id}`),
            modelId: model.id,
          }),
      configured: configured.providerId !== undefined && configured.modelId !== undefined,
      available: model?.available ?? false,
      effect: 'new_sessions',
    };
  }

  /**
   * Lists authenticated and currently available default-model candidates.
   *
   * @returns Candidate catalog.
   */
  public async listDefaultModelCandidates(): Promise<DefaultModelCandidatesDto> {
    const providers = await this.piSettings.listProviders();
    const candidates: DefaultModelCandidateDto[] = providers.flatMap((provider) =>
      provider.models
        .filter((model) => model.available && (model.interfaces ?? ['chat']).includes('chat'))
        .map((model) => ({
          providerKey: opaqueKey(provider.id),
          providerId: provider.id,
          providerName: provider.name,
          modelKey: opaqueKey(`${provider.id}\u0000${model.id}`),
          modelId: model.id,
          modelName: model.name,
          reasoning: model.reasoning,
          ...(model.thinkingLevels ? { thinkingLevels: model.thinkingLevels } : {}),
          input: model.input,
        }))
    );
    return { candidates };
  }

  /**
   * Resolves opaque keys against the latest catalog and persists the selected pair.
   *
   * @param providerKey Opaque Provider key.
   * @param modelKey Opaque Provider-scoped model key.
   * @returns Updated default-model state.
   */
  public async setDefaultModel(providerKey: string, modelKey: string): Promise<DefaultModelDto> {
    const providers = await this.piSettings.listProviders();
    const provider = providers.find((candidate) => opaqueKey(candidate.id) === providerKey);
    const model = provider?.models.find(
      (candidate) => opaqueKey(`${provider.id}\u0000${candidate.id}`) === modelKey
    );
    if (provider === undefined || model === undefined || !(model.interfaces ?? ['chat']).includes('chat')) {
      throw new Error('The selected default model no longer exists.');
    }
    await this.piSettings.setDefaultModel(provider.id, model.id);
    this.modelConfigChanges?.recordDefaultCommitted?.();
    return this.getDefaultModel();
  }

  /**
   * Resolves one Provider route identity or raises the stable Settings error.
   */
  public async requireProvider(providerKey: string): Promise<PiSettingsProvider> {
    const providers = await this.piSettings.listProviders();
    const provider = providers.find((candidate) => opaqueKey(candidate.id) === providerKey);
    if (provider === undefined) {
      throw new ApplicationError('MODEL_PROVIDER_NOT_FOUND', 'The requested model provider does not exist.', {
        statusCode: 404,
      });
    }
    return provider;
  }
}

/**
 * Missing configuration is the valid empty-install state; other IO and JSON failures stay visible.
 */
async function read(path: string): Promise<string> {
  try {
    const value = await readFile(path, 'utf8');
    try {
      JSON.parse(value);
    } catch {
      throw new Error('Model configuration JSON is invalid.');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '{}';
    }
    throw error;
  }
}
/**
 * Computes a process-independent internal version without logging raw secret-bearing input.
 */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ModelConfigMonitor {
  #models: string | undefined;
  #version = '';
  #pending: Promise<string> | undefined;
  #timer: NodeJS.Timeout | undefined;
  #watcher: FSWatcher | undefined;
  #dirty = false;
  #closed = false;
  /**
   * Keeps dependencies explicit so file events, admission and reconnect share one reconciliation.
   */
  constructor(
    private readonly options: {
      agentDir: string;
      changes: RuntimeConfigChanges;
      /**
       * Refreshes local SDK snapshots.
       */
      refresh(): Promise<void>;
      /**
       * Invalidates browser catalogs after a committed default or model change.
       */
      notify(): void;
      /**
       * Reports reconciliation and native watcher failures to its owning Host.
       */
      onError(error: unknown): void;
    }
  ) {}
  /**
   * Shares a coherent read; failures leave the previous baseline intact for retry.
   */
  refresh(): Promise<string> {
    this.#pending ??= (async () => {
      for (let pass = 0; pass < 4; pass++) {
        this.#dirty = false;
        const version = await this.#refresh();
        if (!this.#dirty || this.#closed) {
          return version;
        }
      }
      throw new Error('Configuration kept changing during reconciliation.');
    })().finally(() => {
      this.#pending = undefined;
      if (this.#dirty && !this.#closed) {
        this.invalidate();
      }
    });
    return this.#pending;
  }
  /**
   * Rechecks the files after refresh so a concurrent save cannot be certified with the wrong snapshot.
   */
  async #refresh(): Promise<string> {
    const [models, auth, settings] = await Promise.all(
      ['models.json', 'auth.json', 'settings.json'].map((file) => read(join(this.options.agentDir, file)))
    );
    const parsed = JSON.parse(settings!) as Record<string, unknown>;
    const runtimeModels = JSON.parse(models!) as Record<string, unknown>;
    // Display-only capabilities refresh catalogs without invalidating inference runtimes.
    delete runtimeModels['octopusModelCapabilities'];
    const modelVersion = digest([runtimeModels, auth]);
    const version = digest([models, auth, parsed['defaultProvider'], parsed['defaultModel']]);
    if (version !== this.#version) {
      await this.options.refresh();
      const confirmed = await Promise.all(
        ['models.json', 'auth.json', 'settings.json'].map((file) => read(join(this.options.agentDir, file)))
      );
      if (confirmed[0] !== models || confirmed[1] !== auth || confirmed[2] !== settings) {
        throw new Error('Configuration changed while its catalog was refreshing.');
      }
      if (this.#models !== undefined && modelVersion !== this.#models) {
        this.options.changes.record(MODEL_CONFIG_ROUTE);
      }
      this.#models = modelVersion;
      this.#version = version;
      this.options.notify();
    }
    return version;
  }
  /**
   * Coalesces actual committed writes and native file events, including events during a refresh.
   */
  invalidate(): void {
    if (this.#closed) {
      return;
    }
    this.#dirty = true;
    this.#timer ??= setTimeout(() => {
      this.#timer = undefined;
      void this.refresh().catch((error) => this.options.onError(error));
    }, 100);
    this.#timer.unref();
  }
  /**
   * Watches the directory before taking the initial snapshot, preserving atomic file replacement events.
   */
  async start() {
    await mkdir(this.options.agentDir, { recursive: true });
    if (this.#closed) {
      return;
    }
    this.#watcher = watch(this.options.agentDir, { persistent: false }, (_event, filename) => {
      if (filename === null || ['models.json', 'auth.json', 'settings.json'].includes(filename.toString())) {
        this.invalidate();
      }
    });
    this.#watcher.on('error', (error) => this.options.onError(error));
    await this.refresh();
  }
  /**
   * Stops native subscriptions and pending debounce work before Settings infrastructure shuts down.
   */
  async close() {
    this.#closed = true;
    const watcher = this.#watcher;
    this.#watcher = undefined;
    const stopped = watcher
      ? new Promise<void>((resolve) => watcher.once('close', resolve))
      : Promise.resolve();
    watcher?.close();
    clearTimeout(this.#timer);
    await Promise.all([stopped, this.#pending?.catch(() => undefined)]);
  }
}

export interface ModelConfigChanges {
  /**
   * Records one confirmed commit; the caller owns changed detection and exactly-once reporting.
   */
  recordCommitted(): void;
  /**
   * Refreshes unsubmitted model intent without marking established conversations stale.
   */
  recordDefaultCommitted?(): void;
}

/**
 * Creates a stateless model adapter over the shared Host revision recorder.
 */
export function createModelConfigChanges(
  changes: Pick<RuntimeConfigChanges, 'record'>,
  onDefault: () => void = () => undefined
): ModelConfigChanges {
  return { recordCommitted: () => changes.record(MODEL_CONFIG_ROUTE), recordDefaultCommitted: onDefault };
}
