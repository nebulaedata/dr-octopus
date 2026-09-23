/**
 * @author Codex
 * @description Adapts permission mode changes to the built-in Pi slash command over JSONL RPC.
 */

import { SessionRuntimeError } from './errors.js';
import type { AgentRpcProcess } from '@octopus/agent/rpc';
import type { PermissionMode, PermissionStateDto } from '@octopus/shared/protocol';

type PermissionCommandTransport = Pick<AgentRpcProcess, 'execute'>;

const PERMISSION_MODE_COMMAND = 'permission-mode';

/**
 * Creates the deterministic permission state for one Agent process generation.
 *
 * @param mode Current mode mirrored by the Server runtime.
 * @returns Public runtime-generation permission state.
 */
export function createRuntimePermissionState(mode: PermissionMode): PermissionStateDto {
  return {
    mode,
    scope: 'runtime-generation',
    persisted: false,
  };
}

/**
 * Changes permission mode through Pi's registered slash-command path.
 *
 * @param transport Existing Pi JSONL RPC transport.
 * @param mode Requested permission mode.
 * @returns State that may be committed to the Server mirror after command success.
 */
export async function setRuntimePermissionMode(
  transport: PermissionCommandTransport,
  mode: PermissionMode
): Promise<PermissionStateDto> {
  const response = await transport.execute({
    type: 'prompt',
    message: `/${PERMISSION_MODE_COMMAND} ${mode}`,
  });
  if (response.command !== 'prompt') {
    throw invalidPermissionCommandResponse();
  }
  return createRuntimePermissionState(mode);
}

/**
 * Creates the stable domain error used for an impossible correlated response mismatch.
 *
 * @returns Runtime boundary error without exposing protocol internals.
 */
function invalidPermissionCommandResponse(): SessionRuntimeError {
  return new SessionRuntimeError(
    'SESSION_RUNTIME_STALE',
    'Agent returned an invalid permission command response.'
  );
}
