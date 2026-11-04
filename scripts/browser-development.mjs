/**
 * @author Codex
 * @description Derives one workspace-scoped Browser development identity and isolated local paths for both build entrypoints.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolves physical workspace identity consistently; no runtime or web-supplied Host override is accepted.
 */
export function browserDevelopment(workspace) {
  const root = realpathSync(workspace);
  const key = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
  return {
    key,
    hostName: `com.octopus.executor.browser.dev_${key}`,
    userData: join(homedir(), '.dr-octopus/executor-dev', key, 'electron'),
    profile: join(homedir(), '.dr-octopus/executor-dev', key, 'browser'),
    rendererPort: 41000 + (Number.parseInt(key.slice(0, 4), 16) % 10000),
    runtimePort: 30000 + (Number.parseInt(key.slice(4, 8), 16) % 10000),
    extensionPort: 52000 + (Number.parseInt(key.slice(8, 12), 16) % 10000),
  };
}
