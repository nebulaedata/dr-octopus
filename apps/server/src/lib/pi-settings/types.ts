/**
 * @author Codex
 * @description Defines the Server-owned port for reading and mutating Pi user-scope model settings.
 */

import type {
  ThinkingLevel,
  UpdateModelCapabilitiesBody,
  ConfigureLocalProviderBody,
  CreateLocalProviderBody,
  LocalModelDetectionDto,
  LocalProviderConfigurationDto,
  LocalRuntimeDto,
} from '@octopus/shared/protocol';

export type PiSettingsProviderProvenance = 'builtin' | 'models_json' | 'extension';

export interface PiSettingsModel {
  thinkingLevels?: ThinkingLevel[];
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
  maxTokens: number;
  available: boolean;
  configuration: 'inherited' | 'owned' | 'overridden';
}

export interface PiSettingsProvider {
  local?: LocalProviderConfigurationDto;
  id: string;
  name: string;
  baseUrl?: string;
  provenance: PiSettingsProviderProvenance;
  auth: {
    configured: boolean;
    methods: Array<'api_key' | 'oauth'>;
    activeMethod?: 'api_key' | 'oauth';
    source?: 'stored' | 'runtime' | 'environment' | 'fallback' | 'models_json';
    sourceLabel?: string;
  };
  refreshable: boolean;
  endpointOwned: boolean;
  models: PiSettingsModel[];
}

export interface PiSettingsDefaultModel {
  providerId?: string;
  modelId?: string;
}

export type PiProviderAuthPrompt =
  | { signal?: AbortSignal; type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | {
      signal?: AbortSignal;
      type: 'select';
      message: string;
      options: readonly { id: string; label: string; description?: string }[];
    };

export type PiProviderAuthEvent =
  | { type: 'info'; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: 'progress'; message: string };

export interface PiProviderAuthInteraction {
  signal: AbortSignal;
  /**
   * Requests one Provider-owned authentication value from the Host.
   */
  prompt(prompt: PiProviderAuthPrompt): Promise<string>;
  /**
   * Publishes non-secret progress for the active authentication flow.
   */
  notify(event: PiProviderAuthEvent): void;
}

export class PiCredentialSynchronizationError extends Error {
  /**
   * Creates the stable Server boundary error for a committed Pi credential.
   */
  public constructor(
    public readonly operation: 'login' | 'logout',
    cause?: unknown
  ) {
    super('The credential changed, but the local Provider snapshot could not be synchronized.', { cause });
    this.name = 'PiCredentialSynchronizationError';
  }
}

export interface PiSettingsStore {
  /**
   * Persists model capabilities and refreshes the affected Pi provider snapshot.
   */
  updateModelCapabilities(
    id: string,
    modelId: string,
    input: UpdateModelCapabilitiesBody
  ): Promise<{ changed: boolean; synchronized: boolean }>;
  /**
   * Projects supported onboarding local runtime defaults.
   */
  getLocalRuntimes(): LocalRuntimeDto[];
  /**
   * Creates a persistent local provider draft and returns its Pi identity.
   */
  createLocalProvider(input: CreateLocalProviderBody): Promise<string>;
  /**
   * Detects exposed models using the provider's runtime protocol.
   */
  detectLocalProvider(id: string, baseUrl: string): Promise<LocalModelDetectionDto>;
  /**
   * Saves a verified local model and refreshes the Pi snapshot.
   */
  configureLocalProvider(
    id: string,
    input: ConfigureLocalProviderBody
  ): Promise<{ changed: boolean; synchronized: boolean }>;
  /**
   * Lists the composed Pi Provider catalog without triggering network refresh.
   */
  listProviders(): Promise<PiSettingsProvider[]>;
  /**
   * Reloads on-disk model and auth inputs without network discovery.
   */
  refreshCatalog?(): Promise<void>;
  /**
   * Reads the configured global default-model pair.
   */
  getDefaultModel(): Promise<PiSettingsDefaultModel>;
  /**
   * Persists a validated global default-model pair.
   */
  setDefaultModel(providerId: string, modelId: string): Promise<PiSettingsDefaultModel>;
  /**
   * Runs a Provider-owned Pi authentication flow through a Host interaction port.
   */
  loginProvider(
    providerId: string,
    type: 'api_key' | 'oauth',
    interaction: PiProviderAuthInteraction
  ): Promise<void>;
  /**
   * Removes a stored Provider credential through Pi.
   */
  logoutProvider(providerId: string, signal?: AbortSignal): Promise<void>;
}

export interface CreatePiSettingsStoreOptions {
  agentDir: string;
  controlPlaneCwd?: string;
}
