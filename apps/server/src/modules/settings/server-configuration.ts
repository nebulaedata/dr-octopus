/**
 * @author Codex
 * @description Shares revision-checked configuration writes and exposure confirmation across both Server editors.
 */
import { EnvironmentError } from '@octopus/env-loader';
import {
  createServerEnvironmentStore,
  getServerStartupEnvironment,
  serverEnvironmentDefaults,
} from '../../lib/config/environment.js';
import { loadServerConfig } from '../../lib/config/config.js';
import { resolveServerHost } from '../../lib/config/utils.js';
import { isLoopbackHost } from '../../lib/config/server-setting-fields.js';
import { ConfigurationQueue, controlError } from '../../lib/lifecycle/control.js';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { ServerControl } from '../../lib/lifecycle/control.js';
import type { UpdateEnvironmentBody } from '@octopus/shared/protocol';

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
          throw new ApplicationError(error.code, error.message, {
            statusCode: error.code === 'ENV_INVALID' ? 400 : error.code === 'ENV_IO' ? 500 : 409,
            retryable: false,
            ...(field ? { details: { fields: [{ field, message: error.message }] } } : {}),
          });
        }
        throw error;
      });
  }
}
