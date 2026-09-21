/**
 * @author Codex
 * @description Resolves bundled, global and trusted workspace permission configuration through one validated contract.
 */
import { join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { loadDefaultPermissionConfiguration } from './default-configuration.js';
import { parsePermissionFile, readPermissionFile } from './configuration-files.js';
import { mergePermissionConfiguration } from '../services/configuration.js';
import type { PermissionPolicyRepository } from '../definitions/port.js';
import type { PermissionPolicyLoadResult } from '../definitions/types.js';

export class FilePermissionPolicyRepository implements PermissionPolicyRepository {
  /**
   * Bind global and workspace configuration locations at composition time.
   */
  constructor(
    private readonly agentDir: string,
    private readonly configDirName = CONFIG_DIR_NAME
  ) {}

  /**
   * Resolve all layers atomically in memory; malformed layers never silently drop restrictions.
   */
  load(cwd: string, projectTrusted: boolean): PermissionPolicyLoadResult {
    let configuration = loadDefaultPermissionConfiguration();
    const paths = [join(this.agentDir, 'permission-system.json')];
    if (projectTrusted) {
      paths.push(join(cwd, this.configDirName, 'permission-system.json'));
    }
    for (const path of paths) {
      configuration = mergePermissionConfiguration(
        configuration,
        parsePermissionFile(readPermissionFile(path).raw, path)
      );
    }
    return {
      configuration,
      policy: { tools: configuration.policy.tools, autoTools: configuration.modes.auto.tools },
      audit: {
        permissionReviewLog: configuration.permissionReviewLog,
        reviewLogFieldMaxWidth: configuration.reviewLogFieldMaxWidth,
      },
      diagnostics: [],
    };
  }
}
