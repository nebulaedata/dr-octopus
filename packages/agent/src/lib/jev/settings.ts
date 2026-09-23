/**
 * @author Codex
 * @description Owns revision-checked Jev configuration shared by CLI and Host consumers.
 */
import { join, isAbsolute } from 'node:path';
import {
  jevCredentialUpdateSchema,
  jevSettingsSchema,
  jevSettingsUpdateSchema,
} from '@octopus/shared/protocol';
import { EnvironmentError } from '@octopus/env-loader';
import { createAgentEnvironmentStore } from '../../utils/environment.js';
import { SettingsFile } from '../settings-file.js';
import type {
  JevSettings,
  JevCredentialUpdate,
  JevSettingsSnapshot,
  JevSettingsUpdate,
} from '@octopus/shared/protocol';

export class JevError extends Error {
  /**
   * Carry a safe code without retaining provider bodies or secret-bearing parser diagnostics.
   */
  constructor(public readonly code: string) {
    super(code);
    this.name = 'JevError';
  }
}

export class JevSettingsStore {
  private readonly file;
  readonly path: string;
  private readonly environment;
  /**
   * Bind the trusted Agent directory; no files or services are created until an explicit save.
   */
  constructor(agentDir: string, environment: NodeJS.ProcessEnv = process.env) {
    if (!isAbsolute(agentDir)) {
      throw new JevError('JEV_CONFIG_INVALID');
    }
    this.path = join(agentDir, 'jev.json');
    this.file = new SettingsFile(
      this.path,
      (input) => jevSettingsSchema.parse(input),
      (code) => new JevError(`JEV_CONFIG_${code}`)
    );
    this.environment = createAgentEnvironmentStore(agentDir, environment);
  }
  /**
   * Read the current atomic document on each operation so active Agents observe new settings.
   */
  load(): Promise<{ configuration: JevSettings; revision: string }> {
    return this.file.load();
  }
  /**
   * Expose configuration without ever returning the stored credential.
   */
  async get(): Promise<JevSettingsSnapshot> {
    const { configuration, revision } = await this.load();
    const environment = this.environment.load();
    const keyName = Object.keys(environment.values).find((name) => {
      if (process.platform === 'win32') {
        return name.toUpperCase() === 'TYPESAFE_API_KEY';
      }
      return name === 'TYPESAFE_API_KEY';
    });
    return {
      ...configuration,
      revision,
      hasApiKey: Boolean(keyName && environment.values[keyName]?.trim()),
      environmentRevision: environment.revision,
      hasStoredApiKey: Boolean(environment.persisted.TYPESAFE_API_KEY?.trim()),
      apiKeyOverridden: Boolean(keyName && environment.sources[keyName] === 'process'),
    };
  }
  /**
   * Resolve the next Agent's TYPESAFE_API_KEY through the existing environment precedence.
   * Trusted Host probes may use this value; browser projections expose only its presence.
   */
  getApiKey(): string | undefined {
    const value = this.environment.get('TYPESAFE_API_KEY')?.trim();
    return value || undefined;
  }
  /**
   * Write only TYPESAFE_API_KEY through the existing environment store's atomic revision check.
   * A null value removes the saved override; launch environment values remain authoritative.
   */
  async updateCredential(input: JevCredentialUpdate): Promise<JevSettingsSnapshot> {
    const parsed = jevCredentialUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new JevError('JEV_CONFIG_INVALID');
    }
    try {
      await this.environment.update(parsed.data.revision, { TYPESAFE_API_KEY: parsed.data.apiKey });
    } catch (error) {
      if (error instanceof EnvironmentError) {
        throw new JevError(error.code.replace('ENV_', 'JEV_CONFIG_'));
      }
      throw new JevError('JEV_CONFIG_IO');
    }
    return this.get();
  }
  /**
   * Replace only non-secret policy settings under the existing OS lock and revision fence.
   */
  async update(input: JevSettingsUpdate): Promise<JevSettingsSnapshot> {
    const parsed = jevSettingsUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new JevError('JEV_CONFIG_INVALID');
    }
    await this.file.update(parsed.data.revision, { model: parsed.data.model });
    return this.get();
  }
}
