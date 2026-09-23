/**
 * @author Codex
 * @description Defines the Server-owned port for reading and mutating Pi user-scope model settings.
 */

import type { ThinkingLevel, LocalProviderConfigurationDto } from '@octopus/shared/protocol';

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

export interface CreatePiSettingsStoreOptions {
  agentDir: string;
  controlPlaneCwd?: string;
}
