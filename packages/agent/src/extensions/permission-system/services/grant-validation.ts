/**
 * @author Codex
 * @description Validates durable grant binding and precise tool identities at every execution boundary.
 */
import { PermissionGrantError } from '../definitions/grant.js';
import type { GrantBinding, GrantRepository } from '../definitions/grant.js';
import type { TaskAuthorizationRef } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Resolve the latest committed grant and reject revoked, stale and cross-subject references.
 */
export function requirePermissionGrant(
  repository: GrantRepository,
  binding: GrantBinding,
  ref: TaskAuthorizationRef | null | undefined
) {
  if (!ref) {
    throw new PermissionGrantError(
      'SCHEDULE_AUTHORIZATION_REQUIRED',
      'Task requires persistent user authorization.'
    );
  }
  const grant = repository.get(ref.grantId);
  if (grant && grant.schemaVersion !== 1) {
    throw new PermissionGrantError(
      'SCHEDULE_AUTHORIZATION_UNAVAILABLE',
      'Authorization version is unsupported.'
    );
  }
  if (!grant || grant.state !== 'active') {
    throw new PermissionGrantError('SCHEDULE_AUTHORIZATION_REVOKED', 'Task authorization was revoked.');
  }
  if (
    grant.revision !== ref.grantRevision ||
    ref.executionDigest !== binding.executionDigest ||
    (['profileId', 'subjectId', 'workspaceId', 'executionDigest'] as const).some(
      (key) => grant[key] !== binding[key]
    )
  ) {
    throw new PermissionGrantError(
      'SCHEDULE_AUTHORIZATION_STALE',
      'Task execution content has changed; authorize it again.'
    );
  }
  return grant;
}
