/**
 * @author Codex
 * @description Activates bootstrapped Pi Sessions with immutable identity validation and rollback safety.
 */

import { SessionRuntimeError } from './errors.js';
import { assertWorkspaceCwd, requireRpcState } from './validator.js';
import { canonicalizePath } from '../../utils/index.js';
import type { AgentProcessManager, AgentRpcProcessOptions } from '@octopus/agent/rpc';
import type { WorkspaceDescriptor, WorkspaceSessionBootstrap } from '@octopus/agent';
import type { PiSessionRepository } from './pi-session-repository.js';
import type { ManagedSessionRuntime } from './managed-session.js';

export interface ActivateBootstrappedSessionOptions {
  workspace: WorkspaceDescriptor;
  runtimeId: string;
  manager: AgentProcessManager;
  piSessions: PiSessionRepository;
  bootstrap: WorkspaceSessionBootstrap;
  processOptions: Omit<AgentRpcProcessOptions, 'workspace' | 'sessionPath'>;
  /**
   * Creates a managed runtime only after its immutable identity is validated.
   */
  createRuntime(
    agentSessionId: string,
    canonicalPath: string,
    process: Awaited<ReturnType<AgentProcessManager['start']>>,
    state: ReturnType<typeof requireRpcState>
  ): ManagedSessionRuntime;
}

/**
 * Creates a header-only Pi Session, starts it explicitly, and rolls back unused bootstrap files on failure.
 */
export async function activateBootstrappedSession(
  options: ActivateBootstrappedSessionOptions
): Promise<ManagedSessionRuntime> {
  const pending = await options.bootstrap.create(options.workspace.cwd);
  let canonicalPath: string | undefined;
  try {
    const process = await options.manager.start(options.runtimeId, {
      ...options.processOptions,
      workspace: options.workspace,
      sessionPath: pending.sessionPath,
    });
    const state = requireRpcState(process.getLastSessionState(), options.runtimeId);
    canonicalPath = await canonicalizePath(pending.sessionPath);
    const metadata = await options.piSessions.readMetadata(canonicalPath);
    await assertWorkspaceCwd(options.workspace.cwd, metadata.cwd);
    if (metadata.sessionId !== state.sessionId) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_BINDING_MISMATCH',
        'Created Session metadata differs from Pi readiness identity.'
      );
    }
    return options.createRuntime(metadata.sessionId, canonicalPath, process, state);
  } catch (error) {
    await options.manager.stop(options.runtimeId);
    await pending.cleanup();
    throw error;
  }
}
