/**
 * @author Codex
 * @description Knowledge publication and remote mount management through the existing Settings transport.
 */
import { request } from '@/utils/request';
import type {
  KnowledgeMount,
  KnowledgeOperations,
  KnowledgeSharing,
} from '@octopus/shared/protocol/knowledge';

/**
 * Read the masked publication policy.
 */
export function getKnowledgeSharing(signal?: AbortSignal): Promise<KnowledgeSharing> {
  return request({ url: '/settings/knowledge/sharing', signal });
}

/**
 * Save a CAS policy and return a newly generated token only for this mutation response.
 */
export function saveKnowledgeSharing(
  input: KnowledgeOperations['sharing.save']['input']
): Promise<KnowledgeOperations['sharing.save']['output']> {
  return request({ url: '/settings/knowledge/sharing', method: 'PUT', data: input });
}

/**
 * List saved global connection names without duplicating credential configuration.
 */
export function listKnowledgeConnections(
  signal?: AbortSignal
): Promise<{ name: string; available: boolean }[]> {
  return request({ url: '/settings/knowledge/mounts/connections', signal });
}

/**
 * Read the last complete remote catalog and safe connection status.
 */
export function listKnowledgeMounts(signal?: AbortSignal): Promise<KnowledgeMount[]> {
  return request({ url: '/settings/knowledge/mounts', signal });
}

/**
 * Verify a saved connection before creating a read-only mount.
 */
export function createKnowledgeMount(connectionRef: string): Promise<KnowledgeMount> {
  return request({
    url: '/settings/knowledge/mounts',
    method: 'POST',
    data: { connectionRef },
    timeout: 40_000,
  });
}

/**
 * Refresh or detach a mount without changing its remote documents.
 */
export function changeKnowledgeMount(id: string, action: 'refresh' | 'delete'): Promise<unknown> {
  return request({
    url: `/settings/knowledge/mounts/${encodeURIComponent(id)}${action === 'refresh' ? '/refresh' : ''}`,
    method: action === 'refresh' ? 'POST' : 'DELETE',
    timeout: 40_000,
  });
}
