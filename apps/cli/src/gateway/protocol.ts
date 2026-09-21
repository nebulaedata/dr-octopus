/**
 * @author Codex
 * @description Defines the dependency-free, user-scoped Gateway identity and control contract.
 */

import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { join } from 'node:path';

export interface GatewayIdentity {
  instanceId: string;
  token: string;
  pid: number;
  startedAt: string;
  nodePath: string;
  entryPath: string;
  version: string;
}

export interface GatewayStatus extends Omit<GatewayIdentity, 'token'> {
  state: 'starting' | 'running' | 'stopping' | 'failed';
  phase: string;
  address?: string;
  dataDir?: string;
  fileLogging?: { enabled: boolean; state: string; directory: string };
  warnings: string[];
}

export interface GatewayPaths {
  directory: string;
  record: string;
  endpoint: string;
}

/**
 * Uses the OS account home, independent of cwd, release, port and data-directory overrides.
 */
export function gatewayPaths(): GatewayPaths {
  const account = userInfo();
  const directory = join(account.homedir, '.dr-octopus', 'server', 'state', 'gateway');
  const key = createHash('sha256').update(directory).digest('hex').slice(0, 24);
  return {
    directory,
    record: join(directory, 'instance.json'),
    endpoint:
      process.platform === 'win32' ? `\\\\.\\pipe\\octopus-gateway-${key}` : join(directory, 'control.sock'),
  };
}

/**
 * Produces stable operational error codes without loading business dependencies.
 */
export function gatewayError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * Tests process existence conservatively; permission failures never authorize reclamation.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
