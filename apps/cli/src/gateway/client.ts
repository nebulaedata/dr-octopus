/**
 * @author Codex
 * @description Reads and authenticates the local Gateway without importing Server or Agent runtime modules.
 */

import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { gatewayError, gatewayPaths, isProcessAlive } from './protocol.js';
import type { GatewayIdentity, GatewayPaths, GatewayStatus } from './protocol.js';

/**
 * Reads a complete identity; malformed records fail closed instead of authorizing a new instance.
 */
export async function readGatewayIdentity(
  paths: GatewayPaths = gatewayPaths()
): Promise<GatewayIdentity | null> {
  try {
    const record = JSON.parse(await readFile(paths.record, 'utf8')) as GatewayIdentity;
    if (
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 0 ||
      !['instanceId', 'token', 'startedAt', 'nodePath', 'entryPath', 'version'].every(
        (key) => typeof record[key as keyof GatewayIdentity] === 'string'
      ) ||
      record.token.length < 32
    ) {
      throw new Error('Invalid Gateway identity');
    }
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw gatewayError('GATEWAY_IDENTITY_UNVERIFIED', `Cannot read Gateway identity: ${String(error)}`);
  }
}

/**
 * Exchanges one bounded authenticated request over the OS-local control channel.
 */
export async function requestGateway(
  identity: GatewayIdentity,
  action: 'status' | 'stop' | 'force',
  paths: GatewayPaths = gatewayPaths()
): Promise<GatewayStatus> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(paths.endpoint);
    let body = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('Gateway control timed out')));
    socket.on('error', reject);
    socket.on('connect', () =>
      socket.write(JSON.stringify({ action, token: identity.token, instanceId: identity.instanceId }) + '\n')
    );
    socket.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 131072) {
        socket.destroy(new Error('Gateway response exceeds limit'));
      }
    });
    socket.on('end', () => {
      try {
        const status = JSON.parse(body) as GatewayStatus;
        if (
          status.instanceId !== identity.instanceId ||
          status.pid !== identity.pid ||
          status.startedAt !== identity.startedAt
        ) {
          throw new Error('Gateway identity does not match the control endpoint');
        }
        resolve(status);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

/**
 * Reports absence only for a missing or provably dead owner; a live unverified PID is an error.
 */
export async function getGatewayStatus(paths: GatewayPaths = gatewayPaths()): Promise<GatewayStatus | null> {
  const identity = await readGatewayIdentity(paths);
  if (!identity) {
    return null;
  }
  try {
    return await requestGateway(identity, 'status', paths);
  } catch (error) {
    if (!isProcessAlive(identity.pid)) {
      return null;
    }
    throw gatewayError(
      'GATEWAY_IDENTITY_UNVERIFIED',
      `Gateway owner is alive but cannot be verified: ${String(error)}`
    );
  }
}
