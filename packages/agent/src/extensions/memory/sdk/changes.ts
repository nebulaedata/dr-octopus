/**
 * @author Codex
 * @description Exposes Memory change subscriptions without starting services or leaking their storage schema.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { memoryProfile } from '../lib/profile.js';
import { discoverMemory } from './transport.js';
import { subscribeDaemonChanges } from '../../../lib/daemon-platform/change-subscription.js';
import { resolveMemoryPaths } from '../lib/paths.js';

/**
 * Subscribes to committed changes and lifecycle transitions, reconciling once after connection restoration.
 */
export function subscribeMemoryChanges(
  dataRoot: string | undefined,
  onChange: () => void,
  onError?: (error: unknown) => void
) {
  return subscribeDaemonChanges({
    directory: resolveMemoryPaths(dataRoot).directory,
    onChange,
    onError,
    connect: async (signal) => {
      const profile = await memoryProfile(dataRoot);
      if (!profile) {
        return null;
      }
      const endpoint = await discoverMemory(profile);
      if (!endpoint) {
        return null;
      }
      const token = await readFile(join(profile.directory, 'control-token'), 'utf8');
      return fetch(`http://127.0.0.1:${endpoint.port}/memory/v1/events`, {
        signal,
        redirect: 'error',
        headers: {
          authorization: 'Bearer ' + token,
          'x-memory-profile': profile.profileId,
          'x-memory-daemon': endpoint.daemonId,
        },
      });
    },
  });
}
