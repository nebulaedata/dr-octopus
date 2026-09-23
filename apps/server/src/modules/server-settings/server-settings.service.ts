/**
 * @author Codex
 * @description Projects current and next Server values without exposing the complete environment.
 */
import { EnvironmentError } from '@octopus/env-loader';
import { serverSettingKeys, ServerSettingsSchema } from '@octopus/shared/protocol';
import { loadServerConfig } from '../../infrastructure/config/config.js';
import {
  createServerEnvironmentStore,
  getServerStartupEnvironment,
  serverEnvironmentDefaults,
  validateServerEnvironment,
} from '../../infrastructure/config/environment.js';
import { isLoopbackHost, serverFieldValues } from '../../infrastructure/config/server-setting-fields.js';
import { resolveServerHost } from '../../infrastructure/config/utils.js';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { ConfigurationQueue, controlError } from '../../infrastructure/lifecycle/control.js';
import type { EnvironmentSnapshot } from '@octopus/env-loader';
import type {
  SaveServerSettingsResponse,
  ServerSettingsDto,
  UpdateEnvironmentBody,
} from '@octopus/shared/protocol';
import type { ServerConfig } from '../../infrastructure/config/utils.js';
import type { ServerControl } from '../../infrastructure/lifecycle/control.js';

/**
 * Keeps file intent, effective values and runtime health separate.
 */
export class ServerSettingsService {
  /**
   * Receives actual runtime configuration and a health reader owned by the composition root.
   */
  constructor(
    private readonly config: ServerConfig,
    private readonly configuration: ServerConfiguration,
    private readonly control: ServerControl,
    private readonly health: () => ServerSettingsDto['runtime']
  ) {}
  /**
   * Projects only the twelve public fields and safe diagnostics.
   */
  get(snapshot: EnvironmentSnapshot = this.configuration.get()): ServerSettingsDto {
    const current = serverFieldValues(this.config);
    let next: ReturnType<typeof serverFieldValues> | undefined;
    const diagnostics: string[] = [];
    try {
      validateServerEnvironment(snapshot.persisted);
      next = serverFieldValues(loadServerConfig(snapshot.values));
    } catch {
      diagnostics.push('Saved configuration is invalid. Repair the environment settings before restarting.');
    }
    const known = !!this.control.currentEnvironment;
    const fields = Object.fromEntries(
      serverSettingKeys.map((key) => [
        key,
        {
          stored: {
            configured: Object.hasOwn(snapshot.persisted, key),
            value: snapshot.persisted[key] ?? null,
          },
          current: { configured: true, value: current[key] },
          next: { configured: known && !!next, value: known && next ? next[key] : null },
          source: snapshot.sources[key] ?? 'default',
          overridden: ['process', 'dotenv', 'override'].includes(snapshot.sources[key] ?? ''),
        },
      ])
    );
    const pendingRestartFields =
      known && next ? serverSettingKeys.filter((key) => current[key] !== next[key]) : [];
    const original = this.control.currentEnvironment?.values;
    const additionalPendingRestart =
      !!original &&
      [...new Set([...Object.keys(original), ...Object.keys(snapshot.values)])].some(
        (key) =>
          !serverSettingKeys.includes(key as (typeof serverSettingKeys)[number]) &&
          original[key] !== snapshot.values[key]
      );
    return ServerSettingsSchema.parse({
      revision: snapshot.revision,
      serviceInstanceId: this.control.instanceId,
      fields,
      pendingRestartFields,
      additionalPendingRestart,
      prediction: known ? 'known' : 'host_managed',
      diagnostics,
      runtime: this.health(),
      capabilities: {
        edit: this.control.state() === 'running',
        restart: !!this.control.restart && !diagnostics.length && this.control.state() === 'running',
        reason: !this.control.restart
          ? 'Restart is managed by the embedding Host.'
          : (diagnostics[0] ?? null),
      },
    });
  }
  /**
   * Saves without changing the active runtime; compares the exact committed revision.
   */
  async update(input: UpdateEnvironmentBody, confirmed: boolean): Promise<SaveServerSettingsResponse> {
    const snapshot = await this.configuration.update(input, confirmed);
    const settings = this.get(snapshot);
    return {
      settings,
      outcome: snapshot.revision === input.revision ? 'unchanged' : 'applied',
      warnings: settingsWarnings(settings, input),
      effect: {
        kind: 'server_restart',
        currentServer: 'unchanged',
        requiredAction:
          settings.pendingRestartFields.length || settings.additionalPendingRestart
            ? 'restart_service'
            : 'none',
      },
    };
  }
}

/**
 * Owns Server policy while env-loader owns the atomic file transaction.
 */
export class ServerConfiguration {
  readonly store;
  private readonly queue;
  /**
   * Captures true launch overrides separately from prior file injection.
   */
  constructor(
    directory: string,
    private readonly control?: ServerControl,
    private readonly environment = getServerStartupEnvironment()
  ) {
    this.store = createServerEnvironmentStore(directory, environment, true);
    this.queue = control?.queue ?? new ConfigurationQueue();
  }
  /**
   * Reads structurally safe data even when an old business value needs repair.
   */
  get() {
    try {
      return this.store.load();
    } catch (error) {
      if (error instanceof EnvironmentError) {
        throw controlError(error.code, error.message, error.code === 'ENV_IO' ? 500 : 400);
      }
      throw error;
    }
  }
  /**
   * Validates the persisted and effective candidate, then checks exposure under the writer lock.
   */
  async update(input: UpdateEnvironmentBody, confirmed = false) {
    return this.queue
      .run(async () => {
        this.control?.assertOpen();
        return this.store.update(input.revision, input.changes, {
          check: (before, after) => {
            const defined = Object.fromEntries(
              Object.entries(this.environment).filter(([, value]) => value !== undefined)
            );
            const effective = { ...serverEnvironmentDefaults, ...after, ...defined };
            try {
              loadServerConfig(effective);
            } catch {
              throw controlError(
                'ENV_INVALID',
                'Effective Server configuration is invalid. Check launch overrides and file values.',
                400
              );
            }
            const previousHost = resolveServerHost({ ...before, ...defined }.SERVER_HOST);
            const nextHost = resolveServerHost(effective.SERVER_HOST);
            const changed = before.SERVER_HOST !== after.SERVER_HOST;
            const exposure =
              changed &&
              (after.SERVER_HOST !== undefined
                ? !isLoopbackHost(resolveServerHost(after.SERVER_HOST))
                : isLoopbackHost(previousHost) && !isLoopbackHost(nextHost));
            if (exposure && !confirmed) {
              throw new ApplicationError(
                'SERVER_EXPOSURE_CONFIRMATION_REQUIRED',
                'Confirm that other devices may access workspaces, files, Agent tools and service settings.',
                {
                  statusCode: 409,
                  retryable: false,
                  details: { revision: input.revision, host: after.SERVER_HOST ?? nextHost },
                }
              );
            }
          },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof EnvironmentError) {
          const field = error.message.match(/\bSERVER_[A-Z_]+\b/)?.[0];
          let statusCode = 409;
          if (error.code === 'ENV_INVALID') {
            statusCode = 400;
          } else if (error.code === 'ENV_IO') {
            statusCode = 500;
          }
          throw new ApplicationError(error.code, error.message, {
            statusCode,
            retryable: false,
            ...(field ? { details: { fields: [{ field, message: error.message }] } } : {}),
          });
        }
        throw error;
      });
  }
}

/**
 * Preserves warning precedence for host-managed and launch-overridden settings.
 */
function settingsWarnings(
  settings: ServerSettingsDto,
  input: UpdateEnvironmentBody
): SaveServerSettingsResponse['warnings'] {
  if (settings.prediction === 'host_managed') {
    return [
      {
        code: 'SERVER_HOST_MANAGED',
        message: 'Contact the embedding Host to apply saved settings.',
        nextAction: 'none',
      },
    ];
  }
  if (
    Object.keys(input.changes).some(
      (key) => settings.fields[key as (typeof serverSettingKeys)[number]]?.overridden
    )
  ) {
    return [
      {
        code: 'SERVER_SETTINGS_OVERRIDDEN',
        message: 'Saved values remain overridden by launch configuration.',
        nextAction: 'none',
      },
    ];
  }
  return [];
}
