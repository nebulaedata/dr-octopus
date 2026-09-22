/**
 * @author Codex
 * @description Exposes Knowledge change subscriptions without starting services or leaking their storage schema.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { knowledgeProfile } from '../lib/profile.js';
import { discoverKnowledge } from './transport.js';
import { subscribeDaemonChanges } from '../../../lib/daemon-platform/change-subscription.js';

/**
 * Subscribes to committed changes and lifecycle transitions, reconciling once after connection restoration.
 */
export async function subscribeKnowledgeChanges(
  agentDir: string,
  onChange: () => void,
  onError?: (error: unknown) => void
) {
  const observed = await knowledgeProfile(agentDir);
  return subscribeDaemonChanges({
    directory: observed?.directory ?? join(dirname(resolve(agentDir)), 'knowledge'),
    onChange,
    onError,
    connect: async (signal) => {
      const profile = await knowledgeProfile(agentDir);
      if (!profile) {
        return null;
      }
      const endpoint = await discoverKnowledge(profile);
      if (!endpoint) {
        return null;
      }
      const token = await readFile(join(profile.directory, 'control-token'), 'utf8');
      return fetch(`http://127.0.0.1:${endpoint.port}/knowledge/v1/events`, {
        signal,
        redirect: 'error',
        headers: {
          authorization: 'Bearer ' + token,
          'x-knowledge-profile': profile.profileId,
          'x-knowledge-daemon': endpoint.daemonId,
        },
      });
    },
  });
}
