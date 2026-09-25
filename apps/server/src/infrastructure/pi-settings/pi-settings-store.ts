/**
 * @author Codex
 * @description Projects Pi chat and image catalogs into Server-owned model settings.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CredentialSynchronizationError,
  ModelRuntime,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import { PiCredentialSynchronizationError } from './types.js';
import { saveModelCapabilities } from './custom-provider-repository.js';
import { CustomProviderStore } from './custom-provider-store.js';
import type {
  UpdateModelCapabilitiesBody,
  CustomProviderTypeDto,
  ConfigureCustomProviderBody,
  CreateCustomProviderBody,
} from '@octopus/shared/protocol';
import type {
  CreatePiSettingsStoreOptions,
  PiSettingsDefaultModel,
  PiSettingsModel,
  PiSettingsProvider,
  PiSettingsProviderProvenance,
  PiProviderAuthInteraction,
} from './types.js';

/**
 * Maps a Pi authentication source into the Server settings vocabulary.
 *
 * @param source Pi Provider authentication source.
 * @returns Stable source or undefined when Pi has no configured source.
 */
function mapAuthSource(
  source: ReturnType<ModelRuntime['getProviderAuthStatus']>['source']
): PiSettingsProvider['auth']['source'] {
  if (source === 'models_json_key' || source === 'models_json_command') {
    return 'models_json';
  }
  return source;
}

/**
 * Reads Provider identities explicitly owned by models.json without exposing its secrets.
 *
 * @param modelsPath Canonical Pi models.json path.
 * @returns Provider IDs declared by the document.
 */
async function readConfiguredProviderIds(modelsPath: string): Promise<Set<string>> {
  try {
    const document = JSON.parse(await readFile(modelsPath, 'utf8')) as {
      providers?: Record<string, unknown>;
    };
    return new Set(Object.keys(document.providers ?? {}));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
}

/**
 * Owns Pi user-scope settings access for the Server process.
 */
export class ServerPiSettingsStore {
  readonly #agentDir: string;
  readonly #modelsPath: string;
  readonly #settings: SettingsManager;
  #runtime?: ModelRuntime;
  readonly #imageModels = builtinImagesModels();
  readonly #local: CustomProviderStore;

  /**
   * Creates the store for one explicit Pi user directory.
   *
   * @param options Server-owned Pi path configuration.
   */
  public constructor(options: CreatePiSettingsStoreOptions) {
    this.#agentDir = options.agentDir;
    this.#modelsPath = join(options.agentDir, 'models.json');
    this.#local = new CustomProviderStore(this.#modelsPath, options.agentDir);
    this.#settings = SettingsManager.create(options.controlPlaneCwd ?? process.cwd(), options.agentDir, {
      projectTrusted: false,
    });
  }

  /**
   * Returns the process-local runtime used for side-effect-free catalog reads.
   *
   * @returns Lazily constructed Pi ModelRuntime.
   */
  async #getRuntime(): Promise<ModelRuntime> {
    this.#runtime ??= await ModelRuntime.create({
      authPath: join(this.#agentDir, 'auth.json'),
      modelsPath: this.#modelsPath,
      allowModelNetwork: false,
    });
    return this.#runtime;
  }

  /**
   * Lists Provider, authentication, endpoint and model metadata from one Pi snapshot.
   *
   * @returns Composed Provider catalog.
   */
  public async listProviders(): Promise<PiSettingsProvider[]> {
    const [runtime, configuredProviderIds] = await Promise.all([
      this.#getRuntime(),
      readConfiguredProviderIds(this.#modelsPath),
    ]);
    const available = new Set(
      runtime.getAvailableSnapshot().map((model) => `${model.provider}\u0000${model.id}`)
    );

    const providers = runtime.getProviders().map((provider) => {
      const auth = runtime.getProviderAuthStatus(provider.id);
      const registeredByExtension =
        runtime.getRegisteredProviderConfig(provider.id) !== undefined ||
        runtime.getRegisteredNativeProvider(provider.id) !== undefined;
      let provenance: PiSettingsProviderProvenance;
      if (configuredProviderIds.has(provider.id)) {
        provenance = 'models_json';
      } else {
        if (registeredByExtension) {
          provenance = 'extension';
        } else {
          provenance = 'builtin';
        }
      }
      const models = runtime.getModels(provider.id).map<PiSettingsModel>((model) => ({
        id: model.id,
        name: model.name,
        api: model.api,
        baseUrl: model.baseUrl,
        reasoning: model.reasoning,
        thinkingLevels: getSupportedThinkingLevels(model),
        input: [...model.input],
        interfaces: ['chat'],
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        available: available.has(`${provider.id}\u0000${model.id}`),
        configuration: provenance === 'models_json' ? 'owned' : 'inherited',
      }));
      const source = mapAuthSource(auth.source);
      const methods = [
        provider.auth.apiKey?.login !== undefined && 'api_key',
        provider.auth.oauth !== undefined && 'oauth',
      ].filter((method): method is 'api_key' | 'oauth' => Boolean(method));
      let activeMethod: 'oauth' | 'api_key' | undefined;
      if (auth.configured) {
        if (runtime.isUsingOAuth(provider.id)) {
          activeMethod = 'oauth';
        } else {
          if (methods.includes('api_key')) {
            activeMethod = 'api_key';
          } else {
            activeMethod = undefined;
          }
        }
      } else {
        activeMethod = undefined;
      }
      return {
        id: provider.id,
        name: provider.name,
        ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
        provenance,
        auth: {
          configured: auth.configured,
          methods,
          ...(activeMethod === undefined ? {} : { activeMethod }),
          ...(source === undefined ? {} : { source }),
          ...(auth.label === undefined ? {} : { sourceLabel: auth.label }),
        },
        refreshable: provider.refreshModels !== undefined,
        endpointOwned: provenance === 'models_json',
        models,
      };
    });
    for (const imageProvider of this.#imageModels.getProviders()) {
      const provider = providers.find(
        (candidate) => candidate.id === imageProvider.id && candidate.provenance === 'builtin'
      );
      if (!provider) {
        continue;
      }
      const modelsById = new Map(provider.models.map((model) => [model.id, model]));
      for (const imageModel of imageProvider.getModels()) {
        const existing = modelsById.get(imageModel.id);
        if (existing) {
          existing.interfaces = ['chat', 'image'];
          existing.imageGeneration = imageModel.output.includes('image');
          existing.input = [...new Set([...existing.input, ...imageModel.input])];
        } else {
          const model: PiSettingsModel = {
            id: imageModel.id,
            name: imageModel.name,
            api: imageModel.api,
            baseUrl: imageModel.baseUrl,
            reasoning: false,
            input: [...imageModel.input],
            interfaces: ['image'],
            imageGeneration: imageModel.output.includes('image'),
            available: provider.auth.configured,
            configuration: 'inherited',
          };
          provider.models.push(model);
          modelsById.set(model.id, model);
        }
      }
    }
    return this.#local.project(providers);
  }

  /**
   * Returns supported user-added provider types and endpoint defaults.
   */
  public getCustomProviderTypes(): CustomProviderTypeDto[] {
    return this.#local.getRuntimes();
  }
  /**
   * Persists an independent custom provider draft.
   */
  public createCustomProvider(input: CreateCustomProviderBody) {
    return this.#local.create(input);
  }
  /**
   * Delegates provider-specific discovery to onboarding.
   */
  public async detectCustomProvider(id: string, baseUrl: string, apiKey?: string) {
    return this.#local.detect(id, baseUrl, await this.#getDiscoveryKey(id, apiKey));
  }
  /**
   * Saves every discovered model then refreshes only this provider from the local Pi catalog.
   */
  public async configureCustomProvider(id: string, input: ConfigureCustomProviderBody) {
    const changed = await this.#local.configure(id, input, await this.#getDiscoveryKey(id, input.apiKey));
    const refreshed = await this.#refreshProvider(id, changed);
    if (input.apiKey) {
      await this.loginProvider(id, 'api_key', {
        signal: new AbortController().signal,
        prompt: () => Promise.resolve(input.apiKey!),
        notify: () => undefined,
      });
    }
    return refreshed;
  }

  /**
   * Uses a supplied key for discovery, otherwise resolves only a previously stored Pi credential.
   */
  async #getDiscoveryKey(id: string, supplied?: string): Promise<string | undefined> {
    if (supplied?.trim()) {
      return supplied.trim();
    }
    const runtime = await this.#getRuntime();
    if (!runtime.getProvider(id) || runtime.getProviderAuthStatus(id).source !== 'stored') {
      return undefined;
    }
    return (await runtime.getAuth(id))?.auth.apiKey;
  }

  /**
   * Removes a Settings-created service and its stored credential.
   */
  public async deleteCustomProvider(id: string) {
    const provider = (await this.listProviders()).find((candidate) => candidate.id === id);
    if (provider?.auth.configured) {
      await this.logoutProvider(id);
    }
    const changed = await this.#local.delete(id);
    try {
      const runtime = await this.#getRuntime();
      const result = await runtime.refresh({ allowNetwork: false });
      return { changed, synchronized: !result.aborted && result.errors.size === 0 };
    } catch {
      return { changed, synchronized: false };
    }
  }

  /**
   * Saves capabilities without replacing endpoint, credentials, or unrelated model configuration.
   */
  public async updateModelCapabilities(id: string, modelId: string, input: UpdateModelCapabilitiesBody) {
    const changed = await saveModelCapabilities(this.#modelsPath, id, modelId, input);
    return this.#refreshProvider(id, changed);
  }

  /**
   * Reports committed writes separately from a failed Pi snapshot refresh.
   */
  async #refreshProvider(id: string, changed: boolean) {
    try {
      const runtime = await this.#getRuntime();
      const result = await runtime.refresh({ providers: [id], allowNetwork: false });
      return { changed, synchronized: !result.aborted && !result.errors.has(id) };
    } catch {
      return { changed, synchronized: false };
    }
  }

  /**
   * Reads the persisted global Provider and model pair.
   *
   * @returns Configured pair, which may be incomplete for an existing user file.
   */
  /**
   * Reconciles external configuration edits with the Host catalog before admission.
   */
  public async refreshCatalog(): Promise<void> {
    const runtime = await this.#getRuntime();
    const result = await runtime.refresh({ allowNetwork: false });
    if (result.aborted || result.errors.size > 0) {
      throw new Error('Model catalog refresh failed.');
    }
  }

  public async getDefaultModel(): Promise<PiSettingsDefaultModel> {
    await this.#settings.reload();
    const providerId = this.#settings.getDefaultProvider();
    const modelId = this.#settings.getDefaultModel();
    return {
      ...(providerId === undefined ? {} : { providerId }),
      ...(modelId === undefined ? {} : { modelId }),
    };
  }

  /**
   * Validates availability and persists the global default pair for new Sessions.
   *
   * @param providerId Provider identity owned by Pi.
   * @param modelId Model identity within the Provider.
   * @returns Persisted pair after write verification.
   * @throws Error when the model is absent, unavailable, or persistence reports failures.
   */
  public async setDefaultModel(providerId: string, modelId: string): Promise<PiSettingsDefaultModel> {
    const runtime = await this.#getRuntime();
    const model = runtime.getModel(providerId, modelId);
    if (model === undefined) {
      throw new Error('The selected model does not exist in the current Pi catalog.');
    }
    if (
      !runtime
        .getAvailableSnapshot()
        .some((candidate) => candidate.provider === providerId && candidate.id === modelId)
    ) {
      throw new Error('The selected model is not currently available. Configure its credential first.');
    }
    this.#settings.setDefaultModelAndProvider(providerId, modelId);
    await this.#settings.flush();
    const errors = this.#settings.drainErrors();
    if (errors.length > 0) {
      throw new Error('Pi reported an error while saving the default model.', {
        cause: errors[0]?.error,
      });
    }
    return this.getDefaultModel();
  }

  /**
   * Delegates Provider-specific API Key or OAuth authentication to Pi.
   *
   * @param providerId Provider identity owned by Pi.
   * @param type Requested Pi authentication method.
   * @param interaction Host prompt, event, and cancellation bridge.
   */
  public async loginProvider(
    providerId: string,
    type: 'api_key' | 'oauth',
    interaction: PiProviderAuthInteraction
  ): Promise<void> {
    const runtime = await this.#getRuntime();
    try {
      await runtime.login(providerId, type, interaction);
    } catch (error) {
      if (error instanceof CredentialSynchronizationError) {
        throw new PiCredentialSynchronizationError('login', error);
      }
      throw error;
    }
  }

  /**
   * Removes a stored Provider credential through Pi and refreshes the local snapshot.
   *
   * @param providerId Provider identity owned by Pi.
   * @param signal Caller cancellation signal.
   */
  public async logoutProvider(providerId: string, signal?: AbortSignal): Promise<void> {
    const runtime = await this.#getRuntime();
    try {
      await runtime.logout(providerId, { signal });
    } catch (error) {
      if (error instanceof CredentialSynchronizationError) {
        throw new PiCredentialSynchronizationError('logout', error);
      }
      throw error;
    }
  }
}

/**
 * Creates the Server-owned settings adapter for one explicit Pi user directory.
 *
 * @param options Server-owned Pi path configuration.
 * @returns Pi settings store.
 */
export function createPiSettingsStore(options: CreatePiSettingsStoreOptions): ServerPiSettingsStore {
  return new ServerPiSettingsStore(options);
}
