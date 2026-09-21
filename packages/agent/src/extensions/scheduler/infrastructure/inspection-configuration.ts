/**
 * @author Codex
 * @description Reads noninteractive resource configuration without loading extensions or starting tool providers.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CONFIG_DIR_NAME,
  DefaultPackageManager,
  ProjectTrustStore,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

/**
 * Start with global resources only; project trust must be resolved before an inspection loads project code.
 */
export function inspectionSettings(cwd: string, agentDir: string): SettingsManager {
  const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  if (settings.drainErrors().length) {
    throw new Error('Cannot read Agent settings for authorization inspection.');
  }
  return settings;
}

/**
 * Distinguish missing optional files from unreadable configuration; never initialize an extension.
 */
async function contents(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Bind short-lived previews to settings, policy, MCP configuration and resolved extension entry versions.
 * Execution still checks real tool schemas; this revision does not attest all third-party implementation code.
 */
export async function inspectionConfigurationRevision(agentDir: string, cwd: string): Promise<string> {
  const settings = inspectionSettings(cwd, agentDir);
  // Fingerprint both scopes without importing code: a global handler may grant or deny project access.
  // This discovery-only setting is never reused by the inspection's resource loader.
  settings.setProjectTrusted(true);
  await settings.reload();
  if (settings.drainErrors().length) {
    throw new Error('Cannot read workspace configuration for authorization inspection.');
  }
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
  const resources = await manager.resolve(() => Promise.resolve('skip'));
  const paths = new Set<string>();
  for (const directory of [agentDir, join(cwd, CONFIG_DIR_NAME)]) {
    for (const name of ['settings.json', 'mcp.json', 'permission-system.json']) {
      paths.add(join(directory, name));
    }
  }
  for (const resource of resources.extensions) {
    if (!resource.enabled) {
      continue;
    }
    paths.add(resource.path);
    if (resource.metadata.baseDir) {
      paths.add(join(resource.metadata.baseDir, 'package.json'));
    }
  }
  const files = await Promise.all([...paths].sort().map(async (path) => [path, await contents(path)]));
  return createHash('sha256')
    .update(JSON.stringify([new ProjectTrustStore(agentDir).get(cwd), resources.extensions, files]))
    .digest('hex');
}
