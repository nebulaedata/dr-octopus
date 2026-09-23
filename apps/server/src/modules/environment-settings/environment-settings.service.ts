/**
 * @author Codex
 * @description Owns per-scope environment Settings edits and redacts credentials before transport projection.
 */
import { agentEnvironmentDefaults, createAgentEnvironmentStore } from '@octopus/agent/environment';
import { EnvironmentError } from '@octopus/env-loader';
import {
  createServerEnvironmentStore,
  serverEnvironmentDefaults,
  serverProxyEnvironmentKeys,
} from '../../infrastructure/config/environment.js';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { ServerConfiguration } from '../server-settings/index.js';
import type { EnvironmentSnapshot } from '@octopus/env-loader';
import type {
  EnvironmentScope,
  EnvironmentSettingsDto,
  UpdateEnvironmentBody,
} from '@octopus/shared/protocol';

/**
 * Holds separate configuration stores with startup environment overrides captured once.
 */
export class EnvironmentSettingsService {
  private readonly stores;
  private readonly serverConfiguration;

  /**
   * Receives resolved bootstrap directories; files cannot change their own location.
   */
  constructor(
    serverDirectory: string,
    agentDirectory: string,
    environment?: NodeJS.ProcessEnv,
    configuration?: ServerConfiguration
  ) {
    this.serverConfiguration =
      configuration ?? new ServerConfiguration(serverDirectory, undefined, environment);
    this.stores = {
      server: createServerEnvironmentStore(serverDirectory, environment),
      agent: createAgentEnvironmentStore(agentDirectory, environment),
    };
  }

  /**
   * Reports values that the next service/Agent start would load, without enumerating process secrets.
   */
  get(scope: EnvironmentScope): EnvironmentSettingsDto {
    try {
      return this.project(
        scope,
        scope === 'server' ? this.serverConfiguration.get() : this.stores[scope].load()
      );
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Saves only requested file overrides; an overridden value remains saved for future starts.
   */
  async update(
    scope: EnvironmentScope,
    input: UpdateEnvironmentBody,
    confirmed = false
  ): Promise<EnvironmentSettingsDto> {
    try {
      return this.project(
        scope,
        scope === 'server'
          ? await this.serverConfiguration.update(input, confirmed)
          : await this.stores[scope].update(input.revision, input.changes)
      );
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Lists owned defaults and persisted keys, withholding all custom Agent values from API responses.
   */
  private project(scope: EnvironmentScope, snapshot: EnvironmentSnapshot): EnvironmentSettingsDto {
    const defaults = scope === 'server' ? serverEnvironmentDefaults : agentEnvironmentDefaults;
    const keys = [
      ...new Set([
        ...Object.keys(defaults),
        ...Object.keys(snapshot.persisted),
        ...(scope === 'server' ? serverProxyEnvironmentKeys : []),
      ]),
    ].sort();
    return {
      scope,
      path: snapshot.path,
      revision: snapshot.revision,
      entries: keys.map((key) => {
        const sensitive =
          (scope === 'agent' && !Object.hasOwn(agentEnvironmentDefaults, key)) ||
          (scope === 'server' &&
            serverProxyEnvironmentKeys.some((name) => name === key && name !== 'NO_PROXY'));
        return {
          key,
          sensitive,
          source: snapshot.sources[key] ?? 'default',
          hasStoredValue: Object.hasOwn(snapshot.persisted, key),
          ...(sensitive ? {} : { storedValue: snapshot.persisted[key], resolvedValue: snapshot.values[key] }),
        };
      }),
    };
  }

  /**
   * Translates storage failures into safe domain diagnostics without file contents.
   */
  private mapError(error: unknown): ApplicationError {
    if (error instanceof ApplicationError) {
      return error;
    }
    if (error instanceof EnvironmentError) {
      let statusCode = 500;
      if (error.code === 'ENV_CONFLICT' || error.code === 'ENV_BUSY') {
        statusCode = 409;
      } else if (error.code === 'ENV_INVALID') {
        statusCode = 400;
      }
      return new ApplicationError(error.code, error.message, { statusCode });
    }
    return new ApplicationError('ENV_IO', 'Unable to access environment configuration.', { statusCode: 500 });
  }
}
