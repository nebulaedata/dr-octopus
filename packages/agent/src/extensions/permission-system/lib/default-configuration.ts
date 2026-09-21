/**
 * @author Codex
 * @description Loads the shipped permission JSON resource as the sole source of product defaults.
 */
import { readFileSync } from 'node:fs';
import { PermissionConfigSchema } from '@octopus/shared/protocol';
import type { PermissionResolvedConfig } from '@octopus/shared/protocol';

/**
 * Fail startup when the bundled resource is absent or incomplete instead of inventing fallback permissions.
 */
export function loadDefaultPermissionConfiguration(): PermissionResolvedConfig {
  const config = PermissionConfigSchema.parse(
    JSON.parse(readFileSync(new URL('../config/permission-system.json', import.meta.url), 'utf8'))
  );
  if (
    !config.toolRules ||
    !config.policy?.tools ||
    !config.requestDefaults?.pathFields ||
    !config.requestDefaults.commandFields ||
    typeof config.permissionReviewLog !== 'boolean' ||
    config.reviewLogFieldMaxWidth === undefined ||
    Object.values(config.toolRules).some((rule) => rule === null)
  ) {
    throw new Error('Bundled permission configuration is incomplete');
  }
  for (const name of ['ask', 'auto', 'full'] as const) {
    const mode = config.modes?.[name];
    if (
      !mode?.external ||
      !mode.tools ||
      !mode.kinds ||
      ['read', 'write', 'shell', 'custom'].some((kind) => !(kind in mode.kinds!))
    ) {
      throw new Error('Bundled permission modes are incomplete');
    }
  }
  return config as PermissionResolvedConfig;
}
