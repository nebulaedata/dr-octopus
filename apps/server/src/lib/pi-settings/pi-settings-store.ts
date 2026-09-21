/**
 * @author Codex
 * @description Implements the Server-owned Pi settings adapter using Pi 0.84.3 public APIs.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CredentialSynchronizationError,
  ModelRuntime,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { PiCredentialSynchronizationError } from './types.js';
import { saveModelCapabilities } from './local-provider-repository.js';
import { LocalProviderStore } from './local-provider-store.js';
import type {
  UpdateModelCapabilitiesBody,
  ConfigureLocalProviderBody,
  CreateLocalProviderBody,
} from '@octopus/shared/protocol';
import type {
  CreatePiSettingsStoreOptions,
  PiSettingsDefaultModel,
  PiSettingsModel,
  PiSettingsProvider,
  PiSettingsProviderProvenance,
  PiSettingsStore,
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
class ServerPiSettingsStore implements PiSettingsStore {
  readonly #agentDir: string;
  readonly #modelsPath: string;
  readonly #settings: SettingsManager;
  #runtime?: ModelRuntime;
  readonly #local: LocalProviderStore;

  /**
   * Creates the store for one explicit Pi user directory.
   *
   * @param options Server-owned Pi path configuration.
   */
  public constructor(options: CreatePiSettingsStoreOptions) {
    this.#agentDir = options.agentDir;
    this.#modelsPath = join(options.agentDir, 'models.json');
    this.#local = new LocalProviderStore(this.#modelsPath, options.agentDir);
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

    return this.#local.project(
      runtime.getProviders().map((provider) => {
        const auth = runtime.getProviderAuthStatus(provider.id);
        const registeredByExtension =
          runtime.getRegisteredProviderConfig(provider.id) !== undefined ||
          runtime.getRegisteredNativeProvider(provider.id) !== undefined;
        const provenance: PiSettingsProviderProvenance = configuredProviderIds.has(provider.id)
          ? 'models_json'
          : registeredByExtension
            ? 'extension'
            : 'builtin';
        const models = runtime.getModels(provider.id).map<PiSettingsModel>((model) => ({
          id: model.id,
          name: model.name,
          api: model.api,
          baseUrl: model.baseUrl,
          reasoning: model.reasoning,
          input: [...model.input],
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
        const activeMethod = auth.configured
          ? runtime.isUsingOAuth(provider.id)
            ? 'oauth'
            : methods.includes('api_key')
              ? 'api_key'
              : undefined
          : undefined;
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
      })
    );
  }

  /**
   * Returns onboarding's supported runtime defaults.
   */
  public getLocalRuntimes() {
    return this.#local.onboarding.getLocalRuntimes();
  }
  /**
   * Persists an independent local provider draft.
   */
  public createLocalProvider(input: CreateLocalProviderBody) {
    return this.#local.create(input);
  }
  /**
   * Delegates provider-specific discovery to onboarding.
   */
  public detectLocalProvider(id: string, baseUrl: string) {
    return this.#local.detect(id, baseUrl);
  }
  /**
   * Saves a verified model then refreshes only this provider without network model discovery.
   */
  public async configureLocalProvider(id: string, input: ConfigureLocalProviderBody) {
    const changed = await this.#local.configure(id, input);
    return this.#refreshProvider(id, changed);
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
    if (!runtime.getAvailableSnapshot().some((candidate) => candidate === model)) {
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
export function createPiSettingsStore(options: CreatePiSettingsStoreOptions): PiSettingsStore {
  return new ServerPiSettingsStore(options);
}
