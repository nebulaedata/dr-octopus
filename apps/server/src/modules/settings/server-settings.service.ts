/**
 * @author Codex
 * @description Projects current and next Server values without exposing the complete environment.
 */
import { serverSettingKeys, ServerSettingsSchema } from '@octopus/shared/protocol';
import { loadServerConfig } from '../../lib/config/config.js';
import { validateServerEnvironment } from '../../lib/config/environment.js';
import { serverFieldValues } from '../../lib/config/server-setting-fields.js';
import type { ServerConfiguration } from './server-configuration.js';
import type { ServerControl } from '../../lib/lifecycle/control.js';
import type { ServerConfig } from '../../lib/config/utils.js';
import type { EnvironmentSnapshot } from '@octopus/env-loader';
import type {
  SaveServerSettingsResponse,
  ServerSettingsDto,
  UpdateEnvironmentBody,
} from '@octopus/shared/protocol';

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
      warnings:
        settings.prediction === 'host_managed'
          ? [
              {
                code: 'SERVER_HOST_MANAGED',
                message: 'Contact the embedding Host to apply saved settings.',
                nextAction: 'none',
              },
            ]
          : Object.keys(input.changes).some(
                (key) => settings.fields[key as (typeof serverSettingKeys)[number]]?.overridden
              )
            ? [
                {
                  code: 'SERVER_SETTINGS_OVERRIDDEN',
                  message: 'Saved values remain overridden by launch configuration.',
                  nextAction: 'none',
                },
              ]
            : [],
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
