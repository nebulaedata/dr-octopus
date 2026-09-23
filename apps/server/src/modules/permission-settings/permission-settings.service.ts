/**
 * @author Codex
 * @description Resolves registered workspaces and exposes the Agent-owned permission configuration store to Settings.
 */
import { PermissionConfigurationError, PermissionConfigurationStore } from '@octopus/agent';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import type { PermissionSettingsUpdate } from '@octopus/shared/protocol';
import type { WorkspacesService } from '../workspaces/index.js';

export class PermissionSettingsService {
  private readonly store;

  /**
   * Bind the global Agent directory and the authoritative workspace catalog.
   */
  constructor(
    agentDir: string,
    private readonly workspaces: Pick<WorkspacesService, 'resolve'>
  ) {
    this.store = new PermissionConfigurationStore(agentDir);
  }

  /**
   * Read global configuration or the selected registered workspace overlay.
   */
  async get(workspaceId?: string) {
    const cwd =
      workspaceId === undefined ? undefined : (await this.workspaces.resolve({ id: workspaceId })).cwd;
    try {
      return this.store.get(cwd);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Save validated overrides without accepting client-provided filesystem paths.
   */
  async update(input: PermissionSettingsUpdate, workspaceId?: string) {
    const cwd =
      workspaceId === undefined ? undefined : (await this.workspaces.resolve({ id: workspaceId })).cwd;
    try {
      return await this.store.update(input, cwd);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Translate storage failures into bounded HTTP diagnostics.
   */
  private mapError(error: unknown) {
    if (error instanceof PermissionConfigurationError) {
      return new ApplicationError(error.code, error.message, {
        statusCode: error.code === 'PERMISSION_CONFIG_INVALID' ? 400 : 409,
      });
    }
    return new ApplicationError('PERMISSION_CONFIG_IO', '无法读写权限配置', { statusCode: 500 });
  }
}
