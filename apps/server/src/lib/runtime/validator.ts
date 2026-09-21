/**
 * @author Codex
 * @description Centralizes reusable runtime validation for Workspace, Pi Session, catalog, and RPC state.
 */

import { SessionRuntimeError } from './errors.js';
import { areCanonicalPathsEqual, canonicalizePath } from '../../utils/index.js';
import type { RpcSessionState } from '@earendil-works/pi-coding-agent';
import type { ActivateExistingSessionInput, SessionRuntimeBinding } from './types.js';

/**
 * Requires readiness to expose the exact expected Session identity and canonical path.
 */
export async function assertReadinessIdentity(
  state: RpcSessionState,
  expectedSessionId: string,
  canonicalSessionPath: string
): Promise<void> {
  const actualPath = state.sessionFile === undefined ? undefined : await canonicalizePath(state.sessionFile);
  if (
    state.sessionId !== expectedSessionId ||
    actualPath === undefined ||
    !areCanonicalPathsEqual(actualPath, canonicalSessionPath)
  ) {
    throw new SessionRuntimeError(
      'SESSION_RUNTIME_BINDING_MISMATCH',
      'Pi readiness identity differs from requested Session.'
    );
  }
}

/**
 * Requires the canonical Workspace and Session header cwd to identify the same directory.
 */
export async function assertWorkspaceCwd(workspaceCwd: string, sessionCwd: string): Promise<void> {
  const [workspacePath, sessionPath] = await Promise.all([
    canonicalizePath(workspaceCwd),
    canonicalizePath(sessionCwd),
  ]);
  if (!areCanonicalPathsEqual(workspacePath, sessionPath)) {
    throw new SessionRuntimeError('SESSION_WORKSPACE_MISMATCH', 'Session cwd does not match Workspace cwd.');
  }
}

/**
 * Prevents a catalog route key from opening a different Pi Session header.
 */
export function assertExpectedAgentSessionId(
  expectedAgentSessionId: string,
  actualAgentSessionId: string
): void {
  if (expectedAgentSessionId !== actualAgentSessionId) {
    throw new SessionRuntimeError(
      'SESSION_RUNTIME_BINDING_MISMATCH',
      'Resolved Session identity does not match the requested Session.'
    );
  }
}

/**
 * Requires an existing Lease to represent the same Web-to-Pi Session mapping.
 */
export function assertCatalogBinding(
  input: ActivateExistingSessionInput,
  binding: SessionRuntimeBinding
): void {
  if (input.sessionId !== binding.sessionId) {
    throw new SessionRuntimeError(
      'SESSION_RUNTIME_BINDING_MISMATCH',
      'Resident runtime belongs to a different Web Session.'
    );
  }
  assertExpectedAgentSessionId(input.expectedAgentSessionId, binding.agentSessionId);
}

/**
 * Requires an RPC process to have completed protocol readiness.
 */
export function requireRpcState(state: RpcSessionState | undefined, runtimeId: string): RpcSessionState {
  if (state === undefined) {
    throw new SessionRuntimeError(
      'SESSION_RUNTIME_BINDING_MISMATCH',
      `Runtime has no readiness state: ${runtimeId}`
    );
  }
  return state;
}
