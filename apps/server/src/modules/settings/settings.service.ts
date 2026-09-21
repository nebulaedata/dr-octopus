/**
 * @author Codex
 * @description Maps the Server-owned Pi settings store into opaque-keyed HTTP application use cases.
 */

import { createHash } from 'node:crypto';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { PiCredentialSynchronizationError } from '../../lib/pi-settings/index.js';
import { ProviderAuthSessionManager } from './provider-auth-session-manager.js';
import type { ModelConfigChanges } from './model-config-changes.js';
import type { PiSettingsModel, PiSettingsProvider, PiSettingsStore } from '../../lib/pi-settings/index.js';
import type {
  UpdateModelCapabilitiesBody,
  DefaultModelCandidateDto,
  DefaultModelCandidatesDto,
  DefaultModelDto,
  ModelProviderCatalogDto,
  ModelProviderDetailDto,
  ModelProviderSummaryDto,
  ModelProviderAuthMethod,
  ProviderAuthSessionDto,
  ProviderAuthResetResultDto,
  CreateLocalProviderBody,
  ConfigureLocalProviderBody,
} from '@octopus/shared/protocol';

const PROVIDER_AUTH_RESET_TIMEOUT_MS = 15_000;

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
  return {
    modelKey: opaqueKey(`${provider.id}\u0000${model.id}`),
    modelId: model.id,
    name: model.name,
    api: model.api,
    available: model.available,
    reasoning: model.reasoning,
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    isDefault: defaultModel.providerId === provider.id && defaultModel.modelId === model.id,
    configuration: model.configuration,
  };
}

/**
 * Owns Settings HTTP application behavior while Pi state remains in the Agent SDK.
 */
export class SettingsService {
  readonly #authSessions: ProviderAuthSessionManager;

  /**
   * Creates the application service.
   *
   * @param piSettings Server-owned Pi settings infrastructure port.
   */
  public constructor(
    private readonly piSettings: PiSettingsStore,
    private readonly modelConfigChanges?: ModelConfigChanges
  ) {
    this.#authSessions = new ProviderAuthSessionManager(piSettings, { modelConfigChanges });
  }

  /**
   * Lists all Provider summaries from one coherent snapshot.
   *
   * @returns Provider catalog.
   */
  public async listProviders(): Promise<ModelProviderCatalogDto> {
    const [providers, defaultModel] = await Promise.all([
      this.piSettings.listProviders(),
      this.piSettings.getDefaultModel(),
    ]);
    return { providers: providers.map((provider) => toSummary(provider, defaultModel)) };
  }

  /**
   * Lists the local runtime defaults exposed by onboarding.
   */
  public getLocalRuntimes() {
    return this.piSettings.getLocalRuntimes();
  }
  /**
   * Creates a persistent named draft and returns its routable detail.
   */
  public async createLocalProvider(input: CreateLocalProviderBody) {
    const id = await this.piSettings.createLocalProvider(input);
    return this.getProvider(opaqueKey(id));
  }
  /**
   * Resolves the route identity before read-only local discovery.
   */
  public async detectLocalProvider(key: string, baseUrl: string) {
    const provider = await this.#requireProvider(key);
    return this.piSettings.detectLocalProvider(provider.id, baseUrl);
  }
  /**
   * Resolves an editable custom model before persisting its Pi capability metadata.
   */
  public async updateModelCapabilities(key: string, modelKey: string, input: UpdateModelCapabilitiesBody) {
    const provider = await this.#requireProvider(key);
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
   * Configures a local model without changing the global default pair.
   */
  public async configureLocalProvider(key: string, input: ConfigureLocalProviderBody) {
    const provider = await this.#requireProvider(key);
    const result = await this.piSettings.configureLocalProvider(provider.id, input);
    this.#recordConfiguration(result);
    return this.getProvider(key);
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
        .filter((model) => model.available)
        .map((model) => ({
          providerKey: opaqueKey(provider.id),
          providerId: provider.id,
          providerName: provider.name,
          modelKey: opaqueKey(`${provider.id}\u0000${model.id}`),
          modelId: model.id,
          modelName: model.name,
          reasoning: model.reasoning,
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
    if (provider === undefined || model === undefined) {
      throw new Error('The selected default model no longer exists.');
    }
    await this.piSettings.setDefaultModel(provider.id, model.id);
    return this.getDefaultModel();
  }

  /**
   * Starts a Provider-owned API Key or OAuth authentication session.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authType Authentication method selected by the user.
   * @returns Initial non-secret session snapshot.
   */
  public async createProviderAuthSession(
    providerKey: string,
    authType: ModelProviderAuthMethod
  ): Promise<ProviderAuthSessionDto> {
    const provider = await this.#requireProvider(providerKey);
    if (!provider.auth.methods.includes(authType)) {
      throw new ApplicationError(
        'MODEL_PROVIDER_CAPABILITY_UNSUPPORTED',
        'The selected authentication method is not supported by this Provider.',
        { statusCode: 422 }
      );
    }
    return this.#authSessions.create(providerKey, provider.id, authType);
  }

  /**
   * Reads one route-bound Provider authentication session.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authSessionId Opaque authentication session identity.
   * @returns Current non-secret snapshot.
   */
  public getProviderAuthSession(providerKey: string, authSessionId: string): ProviderAuthSessionDto {
    return this.#authSessions.get(providerKey, authSessionId);
  }

  /**
   * Submits one write-only answer to the active Provider prompt.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authSessionId Opaque authentication session identity.
   * @param promptId Opaque prompt identity.
   * @param answer Write-only user input.
   * @returns Snapshot after accepting the answer.
   */
  public answerProviderAuthPrompt(
    providerKey: string,
    authSessionId: string,
    promptId: string,
    answer: string
  ): ProviderAuthSessionDto {
    return this.#authSessions.answer(providerKey, authSessionId, promptId, answer);
  }

  /**
   * Cancels one active Provider authentication session.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authSessionId Opaque authentication session identity.
   * @returns Updated snapshot, or undefined when already terminal.
   */
  public cancelProviderAuthSession(
    providerKey: string,
    authSessionId: string
  ): ProviderAuthSessionDto | undefined {
    return this.#authSessions.cancel(providerKey, authSessionId);
  }

  /**
   * Deletes the stored credential for one Provider and refreshes its runtime snapshot.
   *
   * @param providerKey Opaque Provider route identity.
   * @returns Credential deletion and snapshot synchronization outcome.
   */
  public async resetProviderAuth(providerKey: string): Promise<ProviderAuthResetResultDto> {
    const provider = await this.#requireProvider(providerKey);
    if (!provider.auth.configured) {
      throw new ApplicationError(
        'MODEL_PROVIDER_AUTH_NOT_CONFIGURED',
        'This Provider does not have an active credential to reset.',
        { statusCode: 409 }
      );
    }
    if (provider.auth.source !== 'stored') {
      throw new ApplicationError(
        'MODEL_PROVIDER_AUTH_RESET_UNSUPPORTED',
        'Only credentials stored by this application can be reset here.',
        { statusCode: 422 }
      );
    }
    this.#authSessions.assertProviderIdle(provider.id);
    try {
      await this.piSettings.logoutProvider(provider.id, AbortSignal.timeout(PROVIDER_AUTH_RESET_TIMEOUT_MS));
      this.modelConfigChanges?.recordCommitted();
      return {
        credentialRemoved: true,
        providerSnapshotSynchronized: true,
        nextAction: 'none',
      };
    } catch (error) {
      if (error instanceof PiCredentialSynchronizationError && error.operation === 'logout') {
        this.modelConfigChanges?.recordCommitted();
        return {
          credentialRemoved: true,
          providerSnapshotSynchronized: false,
          nextAction: 'refresh_provider',
        };
      }
      const timedOut =
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new ApplicationError(
        'MODEL_PROVIDER_AUTH_RESET_FAILED',
        timedOut
          ? 'Resetting the Provider credential timed out.'
          : 'The Provider credential could not be reset.',
        { statusCode: timedOut ? 504 : 502, retryable: true, cause: error }
      );
    }
  }

  /**
   * Releases active authentication sessions during Server shutdown.
   */
  public close(): Promise<void> {
    return this.#authSessions.close();
  }

  /**
   * Resolves one Provider route identity or raises the stable Settings error.
   */
  async #requireProvider(providerKey: string): Promise<PiSettingsProvider> {
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
